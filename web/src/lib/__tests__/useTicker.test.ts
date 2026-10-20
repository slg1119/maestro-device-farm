import { act, renderHook } from "@testing-library/react";

import { useTicker } from "../useTicker";

test("ticks only while active", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ active }) => useTicker(active), { initialProps: { active: true } });
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(3);
  rerender({ active: false });
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current).toBe(3);
  vi.useRealTimers();
});
