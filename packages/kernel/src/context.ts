export type Disposer = () => void;

export type WaterfallHandler = (
  payload: unknown,
  next: () => Promise<unknown>,
) => unknown | Promise<unknown>;

export interface FlintPlugin {
  name: string;
  apply(ctx: Context, config: Record<string, unknown>): void;
}

export class Context {
  #values = new Map<string, unknown>();
  #disposers: Disposer[] = [];
  #hooks = new Map<string, WaterfallHandler[]>();

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

  require<T>(key: string): T {
    if (!this.#values.has(key)) {
      throw new Error(key);
    }
    return this.#values.get(key) as T;
  }

  effect(dispose: Disposer): Disposer {
    this.#disposers.push(dispose);
    return dispose;
  }

  hook(event: string, handler: WaterfallHandler): Disposer {
    const list = this.#hooks.get(event) ?? [];
    list.push(handler);
    this.#hooks.set(event, list);
    const dispose = () => {
      const current = this.#hooks.get(event);
      if (current === undefined) {
        return;
      }
      this.#hooks.set(
        event,
        current.filter((h) => h !== handler),
      );
    };
    this.#disposers.push(dispose);
    return dispose;
  }

  async waterfall<P, R>(
    event: string,
    payload: P,
    terminal: () => Promise<R>,
  ): Promise<R> {
    const handlers = [...(this.#hooks.get(event) ?? [])];
    let index = 0;
    const next = async (): Promise<unknown> => {
      const handler = handlers[index];
      index += 1;
      if (handler === undefined) {
        return terminal();
      }
      return handler(payload, next);
    };
    return (await next()) as R;
  }

  plugin(
    plugin: FlintPlugin,
    config: Record<string, unknown> = {},
  ): Disposer {
    const before = this.#disposers.length;
    plugin.apply(this, config);
    const mine = this.#disposers.slice(before);
    return () => {
      for (const d of mine.reverse()) d();
    };
  }
}
