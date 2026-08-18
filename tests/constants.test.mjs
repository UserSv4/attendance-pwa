import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_KEYS, STATUS_META } from "../src/constants.js";

test("Нету is a distinct fourth option that shares the requested red color", () => {
  assert.deepEqual(STATUS_KEYS, ["present", "sick", "drunk", "absent"]);
  assert.equal(STATUS_META.absent.compactLabel, "Нету");
  assert.equal(STATUS_META.absent.color, STATUS_META.drunk.color);
  assert.notEqual(STATUS_META.absent.mark, STATUS_META.drunk.mark);
});
