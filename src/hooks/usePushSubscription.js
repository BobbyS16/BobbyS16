// usePushSubscription
//
// Source unique de vérité pour l'état push : OneSignal.User.PushSubscription.optedIn.
// La DB profile.push_enabled est synchronisée DEPUIS le SDK via le listener
// "change" — jamais l'inverse. Aucun handler UI ne doit écrire push_enabled
// directement.
//
// Responsabilités :
//   - login(profile.id) idempotent dès que profile.id est connu
//   - logout au SIGNED_OUT Supabase
//   - listener change → setState(optedIn) + sync DB push_enabled
//   - actions optIn/optOut iOS-safe (OneSignalDeferred.push en premier,
//     pas d'await préalable qui détacherait le user-gesture)

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";

export function usePushSubscription(profile) {
  // null = état initial inconnu (avant que le SDK reporte). Permet aux
  // consumers de distinguer "pas encore connu" (null) de "explicitement
  // false" (l'user n'est pas abonné). Ex: la bannière violette n'apparaît
  // que sur `=== false` strict pour éviter un flash au mount.
  const [optedIn, setOptedIn] = useState(null);
  const loggedInForRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    if (typeof window === "undefined" || !window.OneSignalDeferred) return;
    let cleanupListener = null;

    window.OneSignalDeferred.push(async (OneSignal) => {
      if (loggedInForRef.current !== profile.id) {
        try {
          await OneSignal.login(profile.id);
          loggedInForRef.current = profile.id;
          console.log("[OneSignal] login OK", profile.id);
        } catch (e) {
          console.error("[OneSignal] login failed", e);
        }
      }

      try {
        setOptedIn(!!OneSignal.User.PushSubscription.optedIn);
      } catch {}

      const handler = (event) => {
        const next = !!event?.current?.optedIn;
        setOptedIn(next);
        supabase
          .from("profiles")
          .update({ push_enabled: next })
          .eq("id", profile.id)
          .then(({ error }) => {
            if (error) console.warn("[push_enabled sync]", error);
          });
      };
      try {
        OneSignal.User.PushSubscription.addEventListener("change", handler);
        cleanupListener = () => {
          try {
            OneSignal.User.PushSubscription.removeEventListener("change", handler);
          } catch {}
        };
      } catch (e) {
        console.warn("[OneSignal] listener attach failed", e);
      }
    });

    return () => {
      if (cleanupListener) cleanupListener();
    };
  }, [profile?.id]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      loggedInForRef.current = null;
      setOptedIn(false);
      if (typeof window === "undefined" || !window.OneSignalDeferred) return;
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.logout();
        } catch (e) {
          console.warn("[OneSignal] logout failed", e);
        }
      });
    });
    return () => subscription?.unsubscribe();
  }, []);

  // iOS Safari : OneSignalDeferred.push doit être la PREMIÈRE chose
  // dans le call stack du user-gesture. Aucun await avant.
  const optIn = useCallback(() => {
    if (typeof window === "undefined" || !window.OneSignalDeferred) return;
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.Notifications.requestPermission();
        try { await OneSignal.User.PushSubscription.optIn(); } catch {}
      } catch (e) {
        console.error("[OneSignal] optIn err", e);
      }
    });
  }, []);

  const optOut = useCallback(() => {
    if (typeof window === "undefined" || !window.OneSignalDeferred) return;
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.User.PushSubscription.optOut();
      } catch (e) {
        console.error("[OneSignal] optOut err", e);
      }
    });
  }, []);

  return { optedIn, optIn, optOut };
}
