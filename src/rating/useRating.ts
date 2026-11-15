import { useCallback, useEffect, useState } from "react";
import { localLevel, ratingApi, rememberLevel, type Level, type Ratings } from "./api";

export function useRating(guest: boolean) {
  const [ratings, setRatings] = useState<Ratings | null>(null);
  const [level, setLevel] = useState<Level | null>(localLevel);
  const [known, setKnown] = useState(guest);

  const refresh = useCallback(async () => {
    if (guest) return null;
    try {
      let r = await ratingApi.get();
      const mine = localLevel();
      if (!r.level && mine) r = await ratingApi.setLevel(mine);
      setRatings(r);
      if (r.level) {
        setLevel(r.level);
        rememberLevel(r.level);
      } else setLevel(null);
      setKnown(true);
      return r;
    } catch {
      return null;
    }
  }, [guest]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choose = useCallback(
    async (picked: Level) => {
      if (!guest) setRatings(await ratingApi.setLevel(picked));
      rememberLevel(picked);
      setLevel(picked);
    },
    [guest]
  );

  return { ratings, level, needsLevel: known && level === null, choose, refresh };
}
