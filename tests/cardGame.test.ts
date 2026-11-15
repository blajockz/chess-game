import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { PositionCounts } from "../shared/cardGame.js";

test("threefold repetition is retained after a board-card replacement", () => {
  let chess = new Chess();
  const counts = new PositionCounts(chess.fen());
  for (const move of ["Nf3", "Nf6", "Ng1", "Ng8"]) {
    chess.move(move);
    counts.record(chess.fen());
  }
  assert.equal(counts.isThreefold(chess.fen()), false);

  chess = new Chess("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
  assert.equal(counts.isThreefold(chess.fen()), false);
  chess = new Chess();
  for (const move of ["Nf3", "Nf6", "Ng1", "Ng8"]) {
    chess.move(move);
    counts.record(chess.fen());
  }
  assert.equal(counts.isThreefold(chess.fen()), true);
});
