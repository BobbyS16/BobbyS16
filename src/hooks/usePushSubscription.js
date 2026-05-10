// usePushSubscription
//
// Source unique de vérité pour l'état push : OneSignal.User.PushSubscription.optedIn.
// La gestion push se fait désormais via Réglages iOS (pas de toggle in-app).
// La colonne profiles.push_enabled n'est plus lue/écrite côté front.
//
// Responsabilités :
//   - login(profile.id) idempotent dès que profile.id est connu
//   - logout au SIGNED_OUT Supabase
//   - listener change → setState(optedIn) pour piloter la bannière violette
//   - action optIn iOS-safe (OneSignalDeferred.push en premier, pas d'await
//     préalable qui détacherait le user-gesture)
//   - action optOut conservée mais sans consumers actuels.

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
        // On garde uniquement l'état local pour piloter la bannière violette.
        // Plus de sync vers profiles.push_enabled — la gestion est gérée
        // par OneSignal + Réglages iOS.
        setOptedIn(!!event?.current?.optedIn);
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
