interface StatusSink {
  setStatus(key: string, text: string | undefined): void;
}

export class ActivityStatus {
  private readonly active = new Map<object, string>();

  begin(label: string, ui: StatusSink): () => void {
    const token = {};
    this.active.set(token, label);
    this.render(ui);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.active.delete(token);
      this.render(ui);
    };
  }

  clear(): void {
    this.active.clear();
  }

  private render(ui: StatusSink): void {
    if (!this.active.size) {
      ui.setStatus("kontra-active", undefined);
      return;
    }
    const latest = [...this.active.values()].at(-1);
    const text = this.active.size === 1 ? latest : `${this.active.size} measurements`;
    ui.setStatus("kontra-active", `kontra: ${text}`);
  }
}
