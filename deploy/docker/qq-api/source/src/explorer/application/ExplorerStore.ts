import type { ExplorerState } from '../contracts';

export type ExplorerStoreListener = (state: ExplorerState) => void;

export class ExplorerStore {
  private state: ExplorerState;

  private listeners = new Set<ExplorerStoreListener>();

  public constructor(initialState: ExplorerState) {
    this.state = initialState;
  }

  public getState(): ExplorerState {
    return this.state;
  }

  public setState(nextState: ExplorerState): void {
    this.state = nextState;
    this.emit();
  }

  public updateState(updater: (state: ExplorerState) => ExplorerState): void {
    this.setState(updater(this.state));
  }

  public subscribe(listener: ExplorerStoreListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
