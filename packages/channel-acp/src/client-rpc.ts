type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class AcpClientRpc {
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;

  request(method: string, params: unknown, write: (msg: unknown) => void): Promise<unknown> {
    const id = this.#nextId++;
    write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  handleResponse(msg: {
    id?: unknown;
    result?: unknown;
    error?: { message?: string };
  }): boolean {
    if (typeof msg.id !== "number" || !this.#pending.has(msg.id)) {
      return false;
    }
    const pending = this.#pending.get(msg.id)!;
    this.#pending.delete(msg.id);
    if (msg.error !== undefined) {
      pending.reject(new Error(msg.error.message ?? "rpc error"));
      return true;
    }
    pending.resolve(msg.result);
    return true;
  }

  cancelAll(): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new Error("cancelled"));
    }
  }
}
