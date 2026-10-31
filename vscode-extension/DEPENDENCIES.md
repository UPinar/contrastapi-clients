# DEPENDENCIES.md — VS Code Extension API Reference

Used functions and their signatures for the ContrastAPI VS Code Extension.

## @types/vscode (^1.82.0) — VS Code Extension API

### Window — Dialogs & Notifications

```typescript
// Output channel for extension logs
window.createOutputChannel(name: string): OutputChannel

// Text input dialog
window.showInputBox(options?: InputBoxOptions): Thenable<string | undefined>
// InputBoxOptions: { prompt?: string, password?: boolean, ignoreFocusOut?: boolean, placeHolder?: string, value?: string }

// Selection list
window.showQuickPick(items: readonly string[], options?: QuickPickOptions): Thenable<string | undefined>
// QuickPickOptions: { placeHolder?: string, canPickMany?: boolean }

// Notification messages
window.showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>
window.showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>
window.showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>

// Progress indicator
window.withProgress<R>(options: ProgressOptions, task: (progress: Progress<{increment?: number; message?: string}>, token: CancellationToken) => Thenable<R>): Thenable<R>
// ProgressOptions: { location: ProgressLocation, title?: string, cancellable?: boolean }
```

### Window — Views & Panels

```typescript
// TreeView registration — returns Disposable, MUST push to context.subscriptions
window.registerTreeDataProvider<T>(viewId: string, treeDataProvider: TreeDataProvider<T>): Disposable

// Webview panel creation
window.createWebviewPanel(
  viewType: string,
  title: string,
  showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean },
  options?: WebviewPanelOptions & WebviewOptions
): WebviewPanel
// WebviewOptions: { enableScripts?: boolean, localResourceRoots?: Uri[] }

// Status bar
window.createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem
```

### Commands

```typescript
commands.registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable
```

### Workspace

```typescript
workspace.getConfiguration(section?: string): WorkspaceConfiguration
// WorkspaceConfiguration.get<T>(key: string, defaultValue: T): T
```

### TreeView Types

```typescript
interface TreeDataProvider<T> {
  getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
  getChildren(element?: T): ProviderResult<T[]>;
  onDidChangeTreeData?: Event<T | undefined | null | void>;
}

class TreeItem {
  constructor(label: string | TreeItemLabel, collapsibleState?: TreeItemCollapsibleState);
  label?: string | TreeItemLabel;
  collapsibleState?: TreeItemCollapsibleState;
  command?: Command;                                          // { command: string, title: string, arguments?: any[] }
  iconPath?: string | Uri | ThemeIcon | { light: Uri; dark: Uri };
  contextValue?: string;
  description?: string | boolean;
  tooltip?: string | MarkdownString;
}

enum TreeItemCollapsibleState {
  None = 0,       // Leaf item, not expandable
  Collapsed = 1,  // Expandable, starts closed
  Expanded = 2    // Expandable, starts open
}
```

### WebviewPanel & Webview

```typescript
interface WebviewPanel {
  readonly webview: Webview;
  title: string;
  reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
  dispose(): void;
  readonly onDidDispose: Event<void>;
  readonly visible: boolean;
}

interface Webview {
  html: string;                                                // Set full HTML content
  asWebviewUri(localResource: Uri): Uri;                       // Convert local file URI to webview-safe URI
  readonly cspSource: string;                                  // CSP source for style/script tags
  readonly onDidReceiveMessage: Event<any>;                    // Messages from webview JS
  postMessage(message: any): Thenable<boolean>;                // Send message to webview JS
}
```

### Icons

```typescript
class ThemeIcon {
  constructor(id: string, color?: ThemeColor);
  // Built-in IDs used: "shield", "person", "globe", "bug", "warning", "lock"
}
```

### ExtensionContext & Secrets

```typescript
interface ExtensionContext {
  readonly subscriptions: { dispose(): any }[];                // Auto-disposed on deactivation
  readonly secrets: SecretStorage;                             // OS credential store
  readonly extensionUri: Uri;                                  // Extension install directory
}

interface SecretStorage {
  get(key: string): Thenable<string | undefined>;             // Read secret
  store(key: string, value: string): Thenable<void>;          // Write secret
  delete(key: string): Thenable<void>;                        // Delete secret
}
```

### Enums

```typescript
enum ProgressLocation {
  SourceControl = 1,
  Window = 10,        // Status bar
  Notification = 15   // Notification popup with progress bar
}

enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1, Two = 2, Three = 3
}

enum StatusBarAlignment {
  Left = 1,
  Right = 2
}
```

### StatusBarItem

```typescript
interface StatusBarItem {
  text: string;                    // Display text (supports $(icon-name) codicons)
  tooltip?: string | MarkdownString;
  command?: string | Command;      // Command on click
  color?: string | ThemeColor;
  backgroundColor?: ThemeColor;
  show(): void;
  hide(): void;
  dispose(): void;
}
```

### Utilities

```typescript
// Clipboard
env.clipboard.writeText(value: string): Thenable<void>

// URI manipulation
Uri.joinPath(base: Uri, ...pathSegments: string[]): Uri
Uri.file(path: string): Uri

// Events
interface Event<T> {
  (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}
```

---

## esbuild (^0.28.0) — Bundler

```typescript
// Single build
function build(options: BuildOptions): Promise<BuildResult>

// Incremental/watch context
function context(options: BuildOptions): Promise<BuildContext>

interface BuildOptions {
  entryPoints: string[];           // Input files
  bundle?: boolean;                // Inline imports (default: false)
  outfile?: string;                // Output file path
  external?: string[];             // Excluded from bundle (e.g. ["vscode"])
  format?: "iife" | "cjs" | "esm"; // Output format
  platform?: "browser" | "node" | "neutral"; // Target platform
  target?: string | string[];      // e.g. "node18", "es2022"
  sourcemap?: boolean | "linked" | "external" | "inline";
  minify?: boolean;                // Minify output
}

interface BuildContext {
  watch(): Promise<void>;          // Watch mode — auto-rebuild on file changes
  rebuild(): Promise<BuildResult>; // Manual incremental rebuild
  dispose(): void;                 // Clean up
}
```

---

## typescript (^6.0.0) — Compiler

Used only as devDependency for type checking. No runtime API calls.
Key tsconfig.json options used:

```jsonc
{
  "module": "commonjs",           // Output module system
  "target": "ES2022",            // JS version target
  "lib": ["ES2022"],             // Type definitions to include
  "strict": true,                // All strict checks enabled
  "esModuleInterop": true,       // CommonJS/ES module interop
  "skipLibCheck": true,          // Skip .d.ts checking for speed
  "sourceMap": true              // Generate .map files
}
```

---

## @vscode/vsce (^3.7.0) — Extension Packaging & Publishing

CLI tool, not used in code. Commands:

```bash
vsce package                      # Create .vsix file
vsce publish                      # Publish to VS Code Marketplace
vsce login <publisher>            # Login to publisher account
```

---

## Native APIs (no package needed)

### fetch (built into Node 18+ / VS Code 1.82+)

```typescript
function fetch(input: string | URL, init?: RequestInit): Promise<Response>

interface RequestInit {
  method?: string;                 // "GET", "POST", etc.
  headers?: Record<string, string>;
  body?: string;                   // JSON.stringify() for POST
  signal?: AbortSignal;            // For timeouts
}

interface Response {
  ok: boolean;                     // true if status 200-299
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
  headers: Headers;
}

// Timeout via AbortSignal
AbortSignal.timeout(milliseconds: number): AbortSignal
```
