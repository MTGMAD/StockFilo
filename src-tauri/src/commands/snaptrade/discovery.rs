//! Account identity lives in the synced database; credentials stay device-local.
use std::collections::{BTreeMap, HashMap, HashSet};
use rusqlite::{params, Connection};
use crate::brokers::{snaptrade, store, types::RemoteAccount};

pub(super) struct Authorization {
    pub id: String,
    pub institution: String,
    pub accounts: Vec<RemoteAccount>,
}
#[derive(Default)]
pub(super) struct Outcome {
    pub created: usize,
    pub bindings: Vec<(String, String)>,
    pub removed: Vec<String>,
}
struct Account { id: i64, remote: String, protected: bool }
struct Existing { id: String, authorization: Option<String>, accounts: Vec<Account> }

fn existing(conn: &Connection, known: &HashMap<String, String>) -> Result<Vec<Existing>, String> {
    let mut stmt = conn.prepare("SELECT id, remote_authorization_id FROM broker_connections WHERE provider = 'snaptrade' ORDER BY created_at, id").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).map_err(err)?.collect::<Result<Vec<_>, _>>().map_err(err)?;
    rows.into_iter().map(|(id, stored)| {
        if let (Some(a), Some(b)) = (&stored, known.get(&id)) {
            if a != b { return Err("SnapTrade connection identity differs from its saved credentials. No accounts were changed.".into()); }
        }
        let mut stmt = conn.prepare("SELECT a.id, a.provider_account_id, (a.visible != 0 OR EXISTS (SELECT 1 FROM portfolios p WHERE p.broker_account_id = a.id) OR EXISTS (SELECT 1 FROM broker_positions p WHERE p.broker_account_id = a.id) OR EXISTS (SELECT 1 FROM broker_transactions t WHERE t.broker_account_id = a.id)) FROM broker_accounts a WHERE connection_id = ?1 ORDER BY a.id").map_err(err)?;
        let accounts = stmt.query_map([&id], |r| Ok(Account {id:r.get(0)?,remote:r.get(1)?,protected:r.get(2)?})).map_err(err)?.collect::<Result<Vec<_>, _>>().map_err(err)?;
        Ok(Existing {authorization:stored.or_else(|| known.get(&id).cloned()),id,accounts})
    }).collect()
}
fn err(e: impl std::fmt::Display) -> String { e.to_string() }

/// The caller holds a single transaction across every authorization and all
/// credential writes. An ambiguous duplicate rolls the entire discovery back.
pub(super) fn reconcile(conn: &Connection, groups: &[Authorization], known: &HashMap<String, String>, device: &str) -> Result<Outcome, String> {
    let mut outcome = Outcome::default();
    let mut claimed = HashSet::new();
    let mut remote_ids = HashSet::new();
    for group in groups {
        if group.id.trim().is_empty() || group.accounts.is_empty() {
            return Err("SnapTrade returned an incomplete account identity. No accounts were changed.".into());
        }
        for account in &group.accounts {
            if account.id.trim().is_empty() || !remote_ids.insert(&account.id) {
                return Err("SnapTrade returned an ambiguous account identity. No accounts were changed.".into());
            }
        }
        let all = existing(conn, known)?;
        let mut candidates: Vec<_> = all.into_iter().filter(|c| c.authorization.as_deref() == Some(&group.id) || c.accounts.iter().any(|a| group.accounts.iter().any(|r| r.id == a.remote))).collect();
        for c in &candidates {
            if c.authorization.as_ref().is_some_and(|a| a != &group.id) || !claimed.insert(c.id.clone()) {
                return Err("SnapTrade accounts match conflicting connections. No accounts were changed. Keep both copies until their identities can be reviewed.".into());
            }
        }
        // Prefer the original connection with saved/visible accounts over an
        // empty discovery copy. Otherwise keep the oldest connection.
        candidates.sort_by_key(|c| !c.accounts.iter().any(|a| a.protected));
        let is_new = candidates.is_empty();
        let id = candidates.first().map(|c| c.id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if is_new {
            conn.execute("INSERT INTO broker_connections (id,provider,environment,label,credential_ref,device_id,created_at) VALUES (?1,'snaptrade',?2,?3,?4,?5,?6)", params![id,snaptrade::ENVIRONMENT,format!("{} (via SnapTrade)",group.institution),crate::secrets::broker_reference(&id),device,store::now_secs()]).map_err(err)?;
            outcome.created += 1;
        }
        let mut accounts: BTreeMap<&str, Vec<&Account>> = BTreeMap::new();
        for c in &candidates { for a in &c.accounts { accounts.entry(&a.remote).or_default().push(a); } }
        for copies in accounts.values_mut() {
            copies.sort_by_key(|a| (!a.protected, a.id));
            if copies.iter().filter(|a| a.protected).count() > 1 {
                return Err("Duplicate SnapTrade accounts both contain saved data or are shown as portfolios. Nothing was changed. Keep both copies for a reviewed reconciliation; do not disconnect either copy.".into());
            }
            // Only empty, hidden copies with no portfolio, positions, or
            // transactions can be removed automatically.
            for duplicate in copies.iter().skip(1) {
                conn.execute("DELETE FROM broker_accounts WHERE id = ?1", [duplicate.id]).map_err(err)?;
            }
            // Keep the surviving account's local ID, holdings, transaction IDs,
            // visibility, linked portfolio, journal, and display preferences.
            conn.execute("UPDATE broker_accounts SET connection_id = ?1 WHERE id = ?2", params![id,copies[0].id]).map_err(err)?;
        }
        for c in &candidates {
            if c.id != id {
                conn.execute("DELETE FROM broker_connections WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM broker_accounts WHERE connection_id = ?1)", [&c.id]).map_err(err)?;
                outcome.removed.push(c.id.clone());
            }
        }
        for remote in &group.accounts {
            let present: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM broker_accounts WHERE connection_id = ?1 AND provider_account_id = ?2)", params![id,remote.id], |r| r.get(0)).map_err(err)?;
            if !present { store::upsert_account(conn, &id, remote, false).map_err(err)?; }
        }
        conn.execute("UPDATE broker_connections SET remote_authorization_id = ?1 WHERE id = ?2", params![group.id,id]).map_err(err)?;
        outcome.bindings.push((id,group.id.clone()));
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run_all(&conn).unwrap();
        conn
    }
    fn connection(conn: &Connection, id: &str, created: i64) {
        conn.execute("INSERT INTO broker_connections(id,provider,environment,label,credential_ref,created_at) VALUES (?1,'snaptrade','read','Custom brokerage name',?2,?3)", params![id,format!("broker:{id}"),created]).unwrap();
    }
    fn remote(id: &str) -> RemoteAccount {
        RemoteAccount { id:id.into(), mask:Some("1234".into()),currency:"USD".into(),equity:None,cash:None,buying_power:None }
    }
    fn group(auth: &str, ids: &[&str]) -> Authorization {
        Authorization {id:auth.into(),institution:"Same institution".into(),accounts:ids.iter().map(|id|remote(id)).collect()}
    }
    fn run(conn: &Connection, groups: &[Authorization], known: &HashMap<String,String>) -> Result<Outcome,String> {
        let txn=conn.unchecked_transaction().unwrap();
        let out=reconcile(&txn,groups,known,"local-device")?;
        txn.commit().unwrap();
        Ok(out)
    }
    fn count(conn: &Connection, table: &str) -> i64 { conn.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get(0)).unwrap() }
    fn position(conn: &Connection, account: i64) {
        conn.execute("INSERT INTO broker_positions(broker_account_id,provider_symbol,ticker,qty,cost_basis,current_price,snapshot_at) VALUES (?1,'AAPL','AAPL',2,200,150,123)",[account]).unwrap();
    }
    #[test]
    fn imported_accounts_reconnect_without_local_secrets_and_preserve_saved_data() {
        let conn=db();connection(&conn,"original",1);
        let account=store::upsert_account(&conn,"original",&remote("remote1"),true).unwrap();
        conn.execute("UPDATE broker_accounts SET equity=300, cash=17, snapshot_at=123 WHERE id=?1",[account]).unwrap();
        position(&conn,account);
        conn.execute("INSERT INTO broker_transactions(broker_account_id,external_id,kind,provider_symbol,qty,occurred_at) VALUES (?1,'tx1','buy','AAPL',2,'2026-01-01')",[account]).unwrap();
        let portfolio=store::ensure_portfolio(&conn,account,"snaptrade","My renamed portfolio").unwrap();
        conn.execute("UPDATE portfolios SET is_starred=1, position_sort_mode='custom' WHERE id=?1",[portfolio]).unwrap();
        conn.execute("INSERT INTO journal_notes(portfolio_id,trade_key,reflection,lesson,tags,updated_at) VALUES (?1,'trade1','Keep my notes','lesson','[]',123)",[portfolio]).unwrap();
        let result=run(&conn,&[group("auth1",&["remote1"])],&HashMap::new()).unwrap();
        assert_eq!(result.created,0);assert_eq!(result.bindings,vec![("original".into(),"auth1".into())]);
        assert_eq!(store::linked_portfolio(&conn,account).unwrap(),Some(portfolio));
        let saved:(f64,f64,i64,bool)=conn.query_row("SELECT equity,cash,snapshot_at,visible FROM broker_accounts WHERE id=?1",[account],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();assert_eq!(saved,(300.,17.,123,true));
        assert_eq!(count(&conn,"broker_positions"),1);assert_eq!(count(&conn,"broker_transactions"),1);
        let note:String=conn.query_row("SELECT reflection FROM journal_notes WHERE portfolio_id=?1",[portfolio],|r|r.get(0)).unwrap();assert_eq!(note,"Keep my notes");
        let prefs:(String,i64,String)=conn.query_row("SELECT name,is_starred,position_sort_mode FROM portfolios WHERE id=?1",[portfolio],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(prefs,("My renamed portfolio".into(),1,"custom".into()));
        // A later device has the new synced metadata but no keychain entries.
        assert_eq!(run(&conn,&[group("auth1",&["remote1","remote2"])],&HashMap::new()).unwrap().created,0);
        assert_eq!(count(&conn,"broker_connections"),1);assert_eq!(count(&conn,"broker_accounts"),2);
        let visible:bool=conn.query_row("SELECT visible FROM broker_accounts WHERE provider_account_id='remote2'",[],|r|r.get(0)).unwrap();assert!(!visible);
    }
    #[test]
    fn discovery_is_idempotent_and_does_not_match_names_or_masks() {
        let conn=db();
        let groups=[group("auth1",&["one","two"]),group("auth2",&["three"])];
        assert_eq!(run(&conn,&groups,&HashMap::new()).unwrap().created,2);
        for _ in 0..3 { assert_eq!(run(&conn,&groups,&HashMap::new()).unwrap().created,0); }
        assert_eq!(count(&conn,"broker_connections"),2);assert_eq!(count(&conn,"broker_accounts"),3);
    }
    #[test]
    fn removes_only_empty_hidden_duplicate_and_keeps_original_account_ids() {
        let conn=db();connection(&conn,"original",1);connection(&conn,"duplicate",2);
        let original=store::upsert_account(&conn,"original",&remote("same"),true).unwrap();
        position(&conn,original);let p=store::ensure_portfolio(&conn,original,"snaptrade","Keep me").unwrap();
        store::upsert_account(&conn,"duplicate",&remote("same"),false).unwrap();
        let hidden=store::upsert_account(&conn,"original",&remote("hidden"),false).unwrap();
        let outcome=run(&conn,&[group("auth1",&["same","hidden"])],&HashMap::from([("duplicate".into(),"auth1".into())])).unwrap();
        assert_eq!(outcome.created,0);assert_eq!(outcome.removed,vec!["duplicate"]);
        assert_eq!(outcome.bindings,vec![("original".into(),"auth1".into())]);
        assert_eq!(count(&conn,"broker_connections"),1);assert_eq!(count(&conn,"broker_accounts"),2);
        assert_eq!(store::linked_portfolio(&conn,original).unwrap(),Some(p));
        assert_eq!(store::list_positions(&conn,original).unwrap()[0].qty,2.);
        let visible:bool=conn.query_row("SELECT visible FROM broker_accounts WHERE id=?1",[hidden],|r|r.get(0)).unwrap();assert!(!visible);
    }
    #[test]
    fn distinct_saved_accounts_under_duplicate_connections_are_relinked_without_data_loss() {
        let conn=db();connection(&conn,"first",1);connection(&conn,"second",2);
        let a=store::upsert_account(&conn,"first",&remote("one"),true).unwrap();
        let b=store::upsert_account(&conn,"second",&remote("two"),true).unwrap();position(&conn,b);
        let p=store::ensure_portfolio(&conn,b,"snaptrade","Keep second portfolio").unwrap();
        let known=HashMap::from([("first".into(),"auth1".into()),("second".into(),"auth1".into())]);
        run(&conn,&[group("auth1",&["one","two"])],&known).unwrap();
        assert_eq!(count(&conn,"broker_connections"),1);assert_eq!(count(&conn,"broker_accounts"),2);
        assert_eq!(store::linked_portfolio(&conn,b).unwrap(),Some(p));assert_eq!(store::list_positions(&conn,b).unwrap().len(),1);
        let owner:String=conn.query_row("SELECT connection_id FROM broker_accounts WHERE id=?1",[b],|r|r.get(0)).unwrap();assert_eq!(owner,"first");assert_ne!(a,b);
    }
    #[test]
    fn conflicting_saved_duplicates_rollback_entire_discovery() {
        let conn=db();connection(&conn,"original",1);connection(&conn,"duplicate",2);
        for c in ["original","duplicate"] { let id=store::upsert_account(&conn,c,&remote("same"),false).unwrap();position(&conn,id); }
        let before=count(&conn,"broker_accounts");
        let error=run(&conn,&[group("new-auth",&["new-account"]),group("auth1",&["same"])],&HashMap::new()).err().unwrap();
        assert!(error.contains("Nothing was changed"));assert_eq!(count(&conn,"broker_connections"),2);assert_eq!(count(&conn,"broker_accounts"),before);assert_eq!(count(&conn,"broker_positions"),2);
    }
    #[test]
    fn same_remote_account_cannot_be_assigned_to_multiple_authorizations() {
        let conn=db();assert!(run(&conn,&[group("one",&["same"]),group("two",&["same"])],&HashMap::new()).is_err());assert_eq!(count(&conn,"broker_connections"),0);
    }
    #[test]
    fn conflicting_known_authorization_does_not_replace_credentials_identity() {
        let conn=db();connection(&conn,"original",1);store::upsert_account(&conn,"original",&remote("same"),true).unwrap();
        let known=HashMap::from([("original".into(),"old-auth".into())]);
        assert!(run(&conn,&[group("different-auth",&["same"])],&known).is_err());assert_eq!(count(&conn,"broker_connections"),1);
    }
}
