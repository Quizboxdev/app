"use client";

import { useEffect, useState } from "react";
import { getMyAccount, listSignupCountries, type ConfigOption } from "@/lib/api/markets";

// The classes offered in the parent's own market (from the market's configuration), so a child can only be placed in a class that exists there.
export function useGrades(): { grades: ConfigOption[]; levels: ConfigOption[]; ready: boolean } {
  const [state, setState] = useState<{ grades: ConfigOption[]; levels: ConfigOption[]; ready: boolean }>({ grades: [], levels: [], ready: false });
  useEffect(() => {
    let live = true;
    (async () => {
      const [a, countries] = await Promise.all([getMyAccount(), listSignupCountries()]);
      const c = countries.find((x) => x.market_id && x.market_id === a.primary_market?.id) ?? countries.find((x) => x.country === a.country || x.country_code === a.country);
      if (live) setState({ grades: c?.grades ?? [], levels: c?.education_levels ?? [], ready: true });
    })().catch(() => { if (live) setState((s) => ({ ...s, ready: true })); });
    return () => { live = false; };
  }, []);
  return state;
}
