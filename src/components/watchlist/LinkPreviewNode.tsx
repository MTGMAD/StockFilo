import type { ReactElement } from "react";
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { LinkPreviewCard } from "../shared/LinkPreviewCard";

export type SerializedLinkPreviewNode = Spread<{ url: string }, SerializedLexicalNode>;

/**
 * A block-level rich card for a URL that occupies its own line in a note —
 * see `AutoEmbedPlugin` in NoteEditor.tsx for how a plain link paragraph
 * turns into one of these. Round-trips through markdown (the only format
 * notes are ever stored in) as the bare URL, via the custom transformer
 * registered alongside `TRANSFORMERS` in NoteEditor.tsx.
 */
export class LinkPreviewNode extends DecoratorNode<ReactElement> {
  __url: string;

  static getType(): string {
    return "link-preview";
  }

  static clone(node: LinkPreviewNode): LinkPreviewNode {
    return new LinkPreviewNode(node.__url, node.__key);
  }

  static importJSON(serializedNode: SerializedLinkPreviewNode): LinkPreviewNode {
    return $createLinkPreviewNode(serializedNode.url);
  }

  exportJSON(): SerializedLinkPreviewNode {
    return {
      ...super.exportJSON(),
      type: "link-preview",
      version: 1,
      url: this.__url,
    };
  }

  constructor(url: string, key?: NodeKey) {
    super(key);
    this.__url = url;
  }

  getURL(): string {
    return this.__url;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    return div;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  decorate(_editor: LexicalEditor): ReactElement {
    return <LinkPreviewCard url={this.__url} />;
  }
}

export function $createLinkPreviewNode(url: string): LinkPreviewNode {
  return new LinkPreviewNode(url);
}

export function $isLinkPreviewNode(
  node: LexicalNode | null | undefined,
): node is LinkPreviewNode {
  return node instanceof LinkPreviewNode;
}
