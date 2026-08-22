import { randomUUID } from "node:crypto";

import {
  FootballChangeEventSchema,
  type FootballChangeEvent,
  type FootballSnapshot,
  type StatChange,
} from "@bidsentinel/contracts";
import { changedScalarFields } from "./record-fields.js";

type Scalar = string | number | null;

const STANDING_FIELD_NAMES = new Set([
  "rank",
  "points",
  "played",
  "won",
  "drawn",
  "lost",
  "goalsFor",
  "goalsAgainst",
  "teamName",
]);

const PROFILE_FIELD_NAMES = new Set([
  "playerName",
  "team",
  "position",
  "shirtNumber",
  "nationality",
  "name",
  "shortName",
  "country",
  "city",
  "stadium",
  "founded",
  "coach",
]);

const NUMERIC_STAT_FIELDS = new Set([
  "stats.goals",
  "stats.assists",
  "stats.appearances",
  "stats.minutesPlayed",
]);

function numericStatKind(
  field: string,
): "goals" | "assists" | "appearances" | "minutes" {
  switch (field) {
    case "stats.goals":
      return "goals";
    case "stats.assists":
      return "assists";
    case "stats.appearances":
      return "appearances";
    default:
      return "minutes";
  }
}

function statChangeFor(
  field: string,
  before: Scalar,
  after: Scalar,
): StatChange | null {
  if (NUMERIC_STAT_FIELDS.has(field)) {
    if (typeof before === "number" && typeof after === "number") {
      return { kind: numericStatKind(field), before, after };
    }
    return null;
  }

  if (STANDING_FIELD_NAMES.has(field)) {
    return {
      kind: "standing",
      field: field as Extract<
        Extract<StatChange, { kind: "standing" }>["field"],
        string
      >,
      before,
      after,
    };
  }

  if (PROFILE_FIELD_NAMES.has(field)) {
    return {
      kind: "profile",
      field: field as Extract<
        Extract<StatChange, { kind: "profile" }>["field"],
        string
      >,
      before,
      after,
    };
  }

  return null;
}

/**
 * Produces the human-facing change record between two verified snapshots of
 * the same entity. Returns null when the semantic state is unchanged.
 */
export function detectRecordChanges(
  previous: FootballSnapshot,
  current: FootballSnapshot,
  detectedAt: string,
  changeEventId = randomUUID(),
): FootballChangeEvent | null {
  if (previous.record.entityType !== "player") {
    return detectNonPlayerChanges(previous, current, detectedAt, changeEventId);
  }
  if (current.record.entityType !== "player") {
    return null;
  }

  const changes: StatChange[] = [];
  for (const difference of changedScalarFields(
    previous.record,
    current.record,
  )) {
    if (
      difference.field === "stats.yellowCards" ||
      difference.field === "stats.redCards"
    ) {
      continue;
    }
    const change = statChangeFor(
      difference.field,
      difference.before,
      difference.after,
    );
    if (change !== null) {
      changes.push(change);
    }
  }

  const yellowBefore = previous.record.stats.yellowCards;
  const yellowAfter = current.record.stats.yellowCards;
  const redBefore = previous.record.stats.redCards;
  const redAfter = current.record.stats.redCards;
  if (yellowBefore !== yellowAfter || redBefore !== redAfter) {
    changes.push({
      kind: "discipline",
      yellowBefore,
      yellowAfter,
      redBefore,
      redAfter,
    });
  }

  if (changes.length === 0) {
    return null;
  }

  return buildChangeEvent(
    previous,
    current,
    detectedAt,
    changeEventId,
    changes,
  );
}

function detectNonPlayerChanges(
  previous: FootballSnapshot,
  current: FootballSnapshot,
  detectedAt: string,
  changeEventId: string,
): FootballChangeEvent | null {
  if (previous.record.entityType !== current.record.entityType) {
    return null;
  }

  const changes: StatChange[] = [];
  for (const difference of changedScalarFields(
    previous.record,
    current.record,
  )) {
    const change = statChangeFor(
      difference.field,
      difference.before,
      difference.after,
    );
    if (change !== null) {
      changes.push(change);
    }
  }

  if (changes.length === 0) {
    return null;
  }

  return buildChangeEvent(
    previous,
    current,
    detectedAt,
    changeEventId,
    changes,
  );
}

function buildChangeEvent(
  previous: FootballSnapshot,
  current: FootballSnapshot,
  detectedAt: string,
  changeEventId: string,
  changes: StatChange[],
): FootballChangeEvent {
  return FootballChangeEventSchema.parse({
    schemaVersion: 1,
    changeEventId,
    entityId: current.entityId,
    entityType: current.entityType,
    sourceId: current.sourceId,
    fromSnapshotId: previous.snapshotId,
    toSnapshotId: current.snapshotId,
    detectedAt,
    changes,
  });
}
