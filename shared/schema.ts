import { z } from "zod";
export const id = z.string().uuid();
const sentence = z.string().min(1).max(6000);
export const feedbackSchema = z
  .object({
    replyEnglish: sentence,
    replyChinese: sentence,
    grammar: z
      .object({
        hasError: z.boolean(),
        original: z.string().max(6000),
        corrected: z.string().max(6000),
        explanationEnglish: z.string().max(6000),
        explanationChinese: z.string().max(6000),
      })
      .strict(),
    natural: z
      .object({
        original: sentence,
        suggestion: sentence,
        explanationEnglish: sentence,
        explanationChinese: sentence,
      })
      .strict(),
  })
  .strict();
export type Feedback = z.infer<typeof feedbackSchema>;
export function validateFeedback(input: unknown): Feedback {
  const result = feedbackSchema.parse(input);
  if (
    result.grammar.hasError &&
    (!result.grammar.original.trim() ||
      !result.grammar.corrected.trim() ||
      !result.grammar.explanationEnglish.trim() ||
      !result.grammar.explanationChinese.trim())
  )
    throw new Error("文法建議缺少必要內容。");
  return result;
}
export const conversationInputSchema = z
  .object({
    mode: z.enum(["casual", "topic"]),
    topic: z.string().trim().max(200),
  })
  .strict()
  .refine(
    (value) => value.mode === "casual" || value.topic.length > 0,
    "請先選擇或輸入主題。",
  );
export type Conversation = {
  id: string;
  mode: "casual" | "topic";
  topic: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type Turn = {
  id: string;
  conversationId: string;
  userText: string;
  feedback: Feedback | null;
  status: "pending" | "completed" | "failed";
  error: string;
  createdAt: string;
  model: string;
};
export const favoriteSchema = z
  .object({
    id,
    conversationId: id,
    turnId: id,
    kind: z.enum(["grammar", "natural", "reply"]),
    topic: z.string().max(200),
    original: z.string().max(6000),
    suggestion: sentence,
    explanationEnglish: z.string().max(6000),
    explanationChinese: z.string().max(6000),
    note: z.string().max(20000),
    tags: z.array(z.string().trim().min(1).max(50)).max(20),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Favorite = z.infer<typeof favoriteSchema>;
export const preferencesSchema = z
  .object({
    theme: z.enum(["light", "dark"]),
    model: z.string().trim().min(1).max(100),
    showChinese: z.boolean(),
    autoReadReplies: z.boolean().default(true),
    microphoneId: z.string().max(256).default("default"),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  theme: "light",
  model: "choose-after-sign-in",
  showChinese: true,
  autoReadReplies: true,
  microphoneId: "default",
};
export const topics = [
  {
    name: "日常生活",
    english: "Everyday life",
    icon: "☀",
    prompt: "Talk about daily routines, hobbies and small moments.",
  },
  {
    name: "旅行探索",
    english: "Travel",
    icon: "✈",
    prompt: "Talk about travel plans, local culture and getting around.",
  },
  {
    name: "工作職場",
    english: "Work",
    icon: "▣",
    prompt: "Practice everyday workplace conversations and collaboration.",
  },
  {
    name: "餐飲美食",
    english: "Food & dining",
    icon: "☕",
    prompt: "Talk about food, restaurants and ordering meals.",
  },
  {
    name: "交朋友",
    english: "Meeting people",
    icon: "◌",
    prompt: "Practice introductions, interests and friendly small talk.",
  },
  {
    name: "觀點交流",
    english: "Ideas & opinions",
    icon: "✧",
    prompt: "Share opinions about habits, technology and everyday decisions.",
  },
];
