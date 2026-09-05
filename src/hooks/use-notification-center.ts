import { useCallback, useReducer } from "react";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export const NOTICE_FEED_CAP = 100;

export type NoticeCenterState = { items: OccupancyNotice[]; unread: number };
export type NoticeCenterAction = { type: "push"; notice: OccupancyNotice } | { type: "read" };

export const initialNoticeCenterState: NoticeCenterState = { items: [], unread: 0 };

export function noticeCenterReducer(
  state: NoticeCenterState,
  action: NoticeCenterAction,
): NoticeCenterState {
  switch (action.type) {
    case "push":
      return {
        items: [action.notice, ...state.items].slice(0, NOTICE_FEED_CAP),
        unread: state.unread + 1,
      };
    case "read":
      return { ...state, unread: 0 };
  }
}

export function useNotificationCenter() {
  const [state, dispatch] = useReducer(noticeCenterReducer, initialNoticeCenterState);
  const push = useCallback((notice: OccupancyNotice) => dispatch({ type: "push", notice }), []);
  const markRead = useCallback(() => dispatch({ type: "read" }), []);
  return { items: state.items, unread: state.unread, push, markRead };
}
