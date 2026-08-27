import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
  type UIEvent,
  type WheelEvent,
} from "react";
import { createChatLogFollower } from "./chatLogFollow.ts";

type Options = {
  logRef: RefObject<HTMLElement | null>;
  bubbles: unknown;
  draft: string;
  reasoningDraft: string;
  sending: boolean;
};

export function useChatLogFollow({
  logRef,
  bubbles,
  draft,
  reasoningDraft,
  sending,
}: Options) {
  const followerRef = useRef(createChatLogFollower());
  const follower = followerRef.current;

  const pinToBottom = useCallback(() => {
    follower.pin();
    const el = logRef.current;
    if (el) follower.followIfPinned(el);
  }, [follower, logRef]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      follower.onUserScroll(event.currentTarget);
    },
    [follower],
  );

  const onWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (event.deltaY < 0) follower.interrupt();
    },
    [follower],
  );

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) follower.followIfPinned(el);
  }, [bubbles, draft, follower, logRef, reasoningDraft, sending]);

  return { onScroll, onWheel, pinToBottom };
}
