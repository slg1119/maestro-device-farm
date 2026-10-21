import { expect, test } from "vitest";
import { videoPoint } from "./coords";

test("maps CSS pixels through pillarboxing and rejects the bars", () => {
  const rect = { left: 10, top: 20, width: 400, height: 400 };
  expect(videoPoint(210, 220, rect, { width: 100, height: 200 })).toEqual({ x: 50, y: 100 });
  expect(videoPoint(20, 220, rect, { width: 100, height: 200 })).toBeNull();
  expect(videoPoint(310, 420, rect, { width: 100, height: 200 }, true)).toEqual({ x: 99, y: 199 });
});

test("uses each new config size, including landscape letterboxing", () => {
  const rect = { left: 0, top: 0, width: 400, height: 400 };
  expect(videoPoint(100, 200, rect, { width: 200, height: 100 })).toEqual({ x: 50, y: 50 });
  expect(videoPoint(200, 20, rect, { width: 200, height: 100 })).toBeNull();
  expect(videoPoint(0, 0, { ...rect, width: 0 }, { width: 0, height: 0 })).toBeNull();
});
