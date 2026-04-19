import fs from 'fs';
import path from 'path';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  notes?: string;
}

export interface TodoStoreData {
  todos: TodoItem[];
  sessionId: string;
}

const TODO_FILE = 'todo-store.json';

export class TodoStore {
  private missionDir: string;
  private filePath: string;
  private todos: TodoItem[] = [];
  private sessionId: string = '';

  constructor(missionDir: string) {
    this.missionDir = missionDir;
    this.filePath = path.join(missionDir, TODO_FILE);
    this.todos = [];
    this.sessionId = Date.now().toString(36);
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as TodoStoreData;
        this.todos = data.todos || [];
        this.sessionId = data.sessionId || this.sessionId;
      } catch {
        this.todos = [];
      }
    }
  }

  private save(): void {
    const data: TodoStoreData = {
      todos: this.todos,
      sessionId: this.sessionId,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  generateId(): string {
    return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  add(content: string, priority: TodoPriority = 'medium'): TodoItem {
    const todo: TodoItem = {
      id: this.generateId(),
      content,
      status: 'pending',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.todos.push(todo);
    this.save();
    return todo;
  }

  update(id: string, updates: Partial<Omit<TodoItem, 'id' | 'createdAt'>>): TodoItem | null {
    const idx = this.todos.findIndex((t) => t.id === id);
    if (idx === -1) return null;

    this.todos[idx] = {
      ...this.todos[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'completed' && !this.todos[idx].completedAt) {
      this.todos[idx].completedAt = new Date().toISOString();
    }

    this.save();
    return this.todos[idx];
  }

  complete(id: string, notes?: string): TodoItem | null {
    return this.update(id, { status: 'completed', notes });
  }

  cancel(id: string, notes?: string): TodoItem | null {
    return this.update(id, { status: 'cancelled', notes });
  }

  get(id: string): TodoItem | null {
    return this.todos.find((t) => t.id === id) || null;
  }

  list(status?: TodoStatus): TodoItem[] {
    if (status) {
      return this.todos.filter((t) => t.status === status);
    }
    return [...this.todos];
  }

  pending(): TodoItem[] {
    return this.todos.filter((t) => t.status === 'pending');
  }

  completed(): TodoItem[] {
    return this.todos.filter((t) => t.status === 'completed');
  }

  inProgress(): TodoItem[] {
    return this.todos.filter((t) => t.status === 'in_progress');
  }

  markCommandCompleted(cmd: string, result?: string): TodoItem {
    const existing = this.todos.find(
      (t) => t.content === cmd && (t.status === 'pending' || t.status === 'in_progress')
    );
    if (existing) {
      return this.complete(existing.id, result) || existing;
    }
    return this.add(cmd, 'high');
  }

  isCommandDone(cmd: string): boolean {
    return this.todos.some(
      (t) => t.content === cmd && t.status === 'completed'
    );
  }

  getSnapshot(): string {
    const pending = this.pending();
    const completed = this.completed();

    let snapshot = '# Todo Snapshot\n\n';
    snapshot += `## Completed (${completed.length})\n`;
    for (const t of completed.slice(-10)) {
      snapshot += `- [${t.priority.toUpperCase()}] ${t.content}\n`;
    }

    snapshot += `\n## Pending (${pending.length})\n`;
    for (const t of pending) {
      snapshot += `- [${t.priority.toUpperCase()}] ${t.content}\n`;
    }

    return snapshot;
  }

  clear(): void {
    this.todos = [];
    this.save();
  }
}
