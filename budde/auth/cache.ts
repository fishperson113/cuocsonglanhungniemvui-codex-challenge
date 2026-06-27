import { CacheCluster, StringKeyspace, StructKeyspace, expireIn } from "encore.dev/storage/cache";

const cluster = new CacheCluster("auth-cache", {
  evictionPolicy: "allkeys-lru",
});

/** fb_psid → user_id (TTL: 1 giờ) */
export const fbLinkCache = new StringKeyspace<{ fbPsid: string }>(cluster, {
  keyPattern: "fb-link/:fbPsid",
  defaultExpiry: expireIn(60 * 60 * 1000),
});

export interface CachedUser {
  id: string;
  email: string;
  role: string;
}

/** user_id → user auth data (TTL: 30 phút) */
export const userCache = new StructKeyspace<{ userId: string }, CachedUser>(cluster, {
  keyPattern: "user/:userId",
  defaultExpiry: expireIn(30 * 60 * 1000),
});

export interface ProfileCacheData {
  full_name: string;
  grade: string;
  subjects: string[];
  weak_topics: string[];
  availability: Record<string, unknown>;
  exam_dates: Record<string, string>;
  target_scores: Record<string, number>;
  planning_preferences: Record<string, unknown>;
  goals: string;
}

/** user_id → profile data (TTL: 30 phút) */
export const profileCache = new StructKeyspace<{ userId: string }, ProfileCacheData>(cluster, {
  keyPattern: "profile-data/:userId",
  defaultExpiry: expireIn(30 * 60 * 1000),
});
