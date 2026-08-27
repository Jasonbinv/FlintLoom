import { describe, expect, it } from "vitest";
import {
  CHAT_LOG_BOTTOM_THRESHOLD_PX,
  createChatLogFollower,
  isChatLogAtBottom,
  scrollChatLogToBottom,
} from "../src/chatLogFollow.ts";

function box(scrollTop: number, scrollHeight = 1000, clientHeight = 400) {
  return { scrollTop, scrollHeight, clientHeight };
}

describe("isChatLogAtBottom", () => {
  it("treats exact bottom as at bottom", () => {
    expect(isChatLogAtBottom(box(600))).toBe(true);
  });

  it("treats near-bottom within threshold as at bottom", () => {
    expect(
      isChatLogAtBottom(box(600 - CHAT_LOG_BOTTOM_THRESHOLD_PX)),
    ).toBe(true);
  });

  it("treats scrolled-up content as not at bottom", () => {
    expect(
      isChatLogAtBottom(box(600 - CHAT_LOG_BOTTOM_THRESHOLD_PX - 1)),
    ).toBe(false);
    expect(isChatLogAtBottom(box(0))).toBe(false);
  });
});

describe("scrollChatLogToBottom", () => {
  it("sets scrollTop to scrollHeight", () => {
    const el = { scrollHeight: 1200, scrollTop: 10 };
    scrollChatLogToBottom(el);
    expect(el.scrollTop).toBe(1200);
  });
});

describe("createChatLogFollower", () => {
  it("follows after pin, stops when scrolled away, resumes at bottom", () => {
    const follower = createChatLogFollower();
    const el = { scrollHeight: 1000, scrollTop: 0 };

    follower.pin();
    follower.followIfPinned(el);
    expect(follower.isFollowing()).toBe(true);
    expect(el.scrollTop).toBe(1000);

    follower.interrupt();
    expect(follower.isFollowing()).toBe(false);
    el.scrollHeight = 1100;
    follower.followIfPinned(el);
    expect(el.scrollTop).toBe(1000);

    follower.pin();
    follower.followIfPinned(el);
    expect(el.scrollTop).toBe(1100);

    el.scrollTop = 20;
    follower.onUserScroll(box(20));
    expect(follower.isFollowing()).toBe(false);

    el.scrollHeight = 1400;
    follower.followIfPinned(el);
    expect(el.scrollTop).toBe(20);

    el.scrollTop = 1000;
    follower.onUserScroll(box(1000, 1400, 400));
    expect(follower.isFollowing()).toBe(true);

    el.scrollHeight = 1800;
    follower.followIfPinned(el);
    expect(el.scrollTop).toBe(1800);
  });
});
