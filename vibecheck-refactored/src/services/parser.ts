import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";
import type { CodeEntity, CodeRelationship } from "../types";

export type SupportedLanguage = "javascript" | "typescript" | "python";

type TreeSitterLanguage = typeof JavaScript;

const LANGUAGE_MAP: Record<SupportedLanguage, { parser: TreeSitterLanguage; extensions: string[] }> = {
  javascript: { parser: JavaScript, extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  typescript: { parser: TypeScript.typescript, extensions: [".ts", ".mts", ".cts"] },
  python: { parser: Python, extensions: [".py", ".pyi"] },
};

export class TreeSitterParser {
  private parsers: Map<SupportedLanguage, Parser> = new Map();

  constructor() {
    for (const [lang, config] of Object.entries(LANGUAGE_MAP)) {
      const parser = new Parser();
      parser.setLanguage(config.parser);
      this.parsers.set(lang as SupportedLanguage, parser);
    }
  }

  detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    for (const [lang, config] of Object.entries(LANGUAGE_MAP)) {
      if (config.extensions.includes(ext)) {
        return lang as SupportedLanguage;
      }
    }
    return null;
  }

  parseFile(content: string, language: SupportedLanguage): Parser.Tree {
    const parser = this.parsers.get(language);
    if (!parser) {
      throw new Error(`Unsupported language: ${language}`);
    }
    return parser.parse(content);
  }

  extractEntities(tree: Parser.Tree, filePath: string): CodeEntity[] {
    const entities: CodeEntity[] = [];
    const root = tree.rootNode;

    const traverse = (node: Parser.SyntaxNode) => {
      const entity = this.nodeToEntity(node, filePath);
      if (entity) {
        entities.push(entity);
      }
      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i)!);
      }
    };

    traverse(root);
    return entities;
  }

  extractRelationships(
    entities: CodeEntity[],
    tree: Parser.Tree,
    filePath: string
  ): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];
    const root = tree.rootNode;

    const entityIndex = new Map<string, CodeEntity>();
    for (const entity of entities) {
      entityIndex.set(`${entity.file_path}:${entity.line_start}`, entity);
    }

    const findEntityAtLine = (filePath: string, line: number): string | null => {
      for (const entity of entities) {
        if (
          entity.file_path === filePath &&
          entity.line_start <= line &&
          entity.line_end >= line
        ) {
          return entity.id;
        }
      }
      return null;
    };

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === "call_expression") {
        const funcNode = node.childForFieldName("function");
        if (funcNode) {
          const caller = findEntityAtLine(filePath, node.startPosition.row + 1);
          const callee = findEntityAtLine(filePath, funcNode.startPosition.row + 1);
          if (caller && callee && caller !== callee) {
            relationships.push({
              source_id: caller,
              target_id: callee,
              relationship_type: "calls",
            });
          }
        }
      }

      if (node.type === "import_statement" || node.type === "import_from_statement") {
        const imported = node.childForFieldName("module");
        if (imported) {
          const importer = findEntityAtLine(filePath, node.startPosition.row + 1);
          if (importer) {
            relationships.push({
              source_id: importer,
              target_id: `import:${imported.text}`,
              relationship_type: "imports",
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i)!);
      }
    };

    traverse(root);
    return relationships;
  }

  private nodeToEntity(node: Parser.SyntaxNode, filePath: string): CodeEntity | null {
    const lineStart = node.startPosition.row + 1;
    const lineEnd = node.endPosition.row + 1;

    switch (node.type) {
      case "function_declaration":
      case "function_expression":
      case "arrow_function":
        const funcName = node.childForFieldName("name");
        return {
          id: `func:${filePath}:${lineStart}`,
          type: "function",
          name: funcName?.text || `<anonymous:${lineStart}>`,
          file_path: filePath,
          line_start: lineStart,
          line_end: lineEnd,
          code_snippet: node.text,
        };

      case "class_declaration":
        const className = node.childForFieldName("name");
        return {
          id: `class:${filePath}:${lineStart}`,
          type: "class",
          name: className?.text || `<anonymous:${lineStart}>`,
          file_path: filePath,
          line_start: lineStart,
          line_end: lineEnd,
          code_snippet: node.text,
        };

      case "decorated_definition":
        const definition = node.childForFieldName("definition");
        if (definition?.type === "function_declaration") {
          const decorator = node.childForFieldName("decorator");
          if (decorator?.text === "@router.post" || decorator?.text === "@app.get") {
            return {
              id: `endpoint:${filePath}:${lineStart}`,
              type: "endpoint",
              name: this.extractEndpointName(decorator.text),
              file_path: filePath,
              line_start: lineStart,
              line_end: lineEnd,
              code_snippet: node.text,
            };
          }
        }
        return null;

      case "query":
      case "delete_statement":
      case "insert_statement":
      case "update_statement":
        return {
          id: `sql:${filePath}:${lineStart}`,
          type: "sql_query",
          name: `SQL at line ${lineStart}`,
          file_path: filePath,
          line_start: lineStart,
          line_end: lineEnd,
          code_snippet: node.text,
        };

      case "for_statement":
      case "while_statement":
      case "do_statement":
        return {
          id: `loop:${filePath}:${lineStart}`,
          type: "loop",
          name: `${node.type} at line ${lineStart}`,
          file_path: filePath,
          line_start: lineStart,
          line_end: lineEnd,
          code_snippet: node.text,
        };

      default:
        return null;
    }
  }

  private extractEndpointName(decorator: string): string {
    const match = decorator.match(/@(?:router|app)\.(get|post|put|patch|delete)\(["'](.+?)["']\)/);
    if (!match) return decorator;
    return `${match[1]!.toUpperCase()} ${match[2]!}`;
  }
}

export const treeSitterParser = new TreeSitterParser();
