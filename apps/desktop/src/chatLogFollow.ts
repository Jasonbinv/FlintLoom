export const CHAT_LOG_BOTTOM_THRESHOLD_PX = 72;

export type ChatLogScrollBox = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function isChatLogAtBottom(
  box: ChatLogScrollBox,
  thresholdPx = CHAT_LOG_BOTTOM_THRESHOLD_PX,
): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= thresholdPx;
}

export function scrollChatLogToBottom(el: { scrollHeight: number; scrollTop: number }): void {
  el.scrollTop = el.scrollHeight;
}

export type ChatLogFollower = {
  pin(): void;
  interrupt(): void;
  onUserScroll(box: ChatLogScrollBox): void;
  isFollowing(): boolean;
  followIfPinned(el: { scrollHeight: number; scrollTop: number }): void;
};

export function createChatLogFollower(): ChatLogFollower {
  let following = true;
  return {
    pin() {
      following = true;
    },
    interrupt() {
      following = false;
    },
    onUserScroll(box) {
      following = isChatLogAtBottom(box);
    },
    isFollowing() {
      return following;
    },
    followIfPinned(el) {
      if (!following) return;
      scrollChatLogToBottom(el);
    },
  };
}
