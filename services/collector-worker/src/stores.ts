import type {
  QuarantinedExtraction,
  RecoveryEvidence,
  SourceHealth,
  FootballChangeEvent,
  FootballSnapshot,
} from "@bidsentinel/contracts";

export class InMemorySnapshotStore {
  readonly #items = new Map<string, FootballSnapshot[]>();

  append(snapshot: FootballSnapshot): void {
    const existing = this.#items.get(snapshot.entityId) ?? [];
    this.#items.set(snapshot.entityId, [
      ...existing,
      structuredClone(snapshot),
    ]);
  }

  latest(entityId: string): FootballSnapshot | null {
    const snapshot = this.#items.get(entityId)?.at(-1);
    return snapshot === undefined ? null : structuredClone(snapshot);
  }

  list(entityId: string): FootballSnapshot[] {
    return structuredClone(this.#items.get(entityId) ?? []);
  }

  listUniqueEntityIds(): string[] {
    return Array.from(this.#items.keys());
  }
}

export class InMemoryQuarantineStore {
  readonly #items: QuarantinedExtraction[] = [];

  append(extraction: QuarantinedExtraction): void {
    this.#items.push(extraction);
  }

  listBySource(sourceId: string): QuarantinedExtraction[] {
    return this.#items.filter((item) => item.sourceId === sourceId);
  }

  list(): QuarantinedExtraction[] {
    return structuredClone(this.#items);
  }
}

export class InMemoryChangeEventStore {
  readonly #items: FootballChangeEvent[] = [];

  append(event: FootballChangeEvent): void {
    this.#items.push(structuredClone(event));
  }

  list(): FootballChangeEvent[] {
    return structuredClone(this.#items);
  }
}

export class InMemoryRecoveryEvidenceStore {
  readonly #items: RecoveryEvidence[] = [];

  append(evidence: RecoveryEvidence): void {
    this.#items.push(structuredClone(evidence));
  }

  listBySource(sourceId: string): RecoveryEvidence[] {
    return structuredClone(
      this.#items.filter((item) => item.sourceId === sourceId),
    );
  }
}

export class InMemorySourceHealthStore {
  readonly #items = new Map<string, SourceHealth>();

  set(health: SourceHealth): void {
    this.#items.set(health.sourceId, structuredClone(health));
  }

  get(sourceId: string): SourceHealth | null {
    const health = this.#items.get(sourceId);
    return health === undefined ? null : structuredClone(health);
  }

  listSourceIds(): string[] {
    return Array.from(this.#items.keys());
  }
}
