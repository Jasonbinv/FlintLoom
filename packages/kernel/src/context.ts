export interface FlintPlugin {
  name: string;
  apply(ctx: Context): void;
}

export type Disposer = () => void;

export class Context {
  #values = new Map<string, unknown>();
  #disposers: Disposer[] = [];

  provide(key: string, value: unknown): Disposer {
    this.#values.set(key, value);
    const dispose = () => {
      this.#values.delete(key);
    };
    this.#disposers.push(dispose);
    return dispose;
  }

  get<T>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  plugin(plugin: FlintPlugin): Disposer {
    const before = this.#disposers.length;
    plugin.apply(this);
    const mine = this.#disposers.slice(before);
    return () => {
      for (const d of mine.reverse()) d();
    };
  }
}
