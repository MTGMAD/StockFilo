import { createContext } from "react";
import type { LinkOpenMode } from "../types";

/**
 * Lets a Lexical decorator node's rendered React tree (which can't receive
 * props directly — nodes only carry serializable state) reach the user's
 * link-open preference, the same value `NoteEditor` already threads to its
 * sibling plugins as a prop.
 */
export const LinkOpenModeContext = createContext<LinkOpenMode>("browser");
