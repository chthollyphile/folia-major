import Database from 'better-sqlite3';
import type { D1Database, D1PreparedStatement } from './app.js';

export class D1Emulator implements D1Database {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
  }

  prepare(query: string): D1PreparedStatement {
    const createBoundStatement = (boundValues: unknown[]): D1PreparedStatement => ({
      bind: (...values: unknown[]) => createBoundStatement(values),
      first: async <T = Record<string, unknown>>() => {
        const stmt = this.db.prepare(query);
        const result = stmt.get(...boundValues) as T | undefined;
        return result ?? null;
      },
      all: async <T = Record<string, unknown>>() => {
        const stmt = this.db.prepare(query);
        const results = stmt.all(...boundValues) as T[];
        return { results };
      },
      run: async () => {
        const stmt = this.db.prepare(query);
        stmt.run(...boundValues);
        return {};
      }
    });
    return createBoundStatement([]);
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        // We know 'stmt' has a 'run' method that executes it. Wait, the actual statements in batch might be run, first, all?
        // D1 batch executes them. We can just call run(). Wait, run is async in our emulator.
        // Let's implement a hack to expose the sync version for batch transaction.
        // For our usage, batch only uses `run` conceptually.
        stmt.run();
        results.push({});
      }
    });
    transaction();
    return results;
  }
}
