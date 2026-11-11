import type { Conversation, Guidance } from "./schema";

// Clearly labelled built-in opening exercises; never presented as AI-generated.
export function openingExercise(conversation: Pick<Conversation, "mode">): {
  questionEnglish: string;
  questionChinese: string;
  guidance: Guidance;
} {
  if (conversation.mode === "casual")
    return {
      questionEnglish: "What do you usually do on weekends?",
      questionChinese: "你週末通常做什麼？",
      guidance: {
        starterEnglish: "On weekends, I usually…",
        starterChinese: "我週末通常會……",
        options: [
          {
            chinese: "在家看電影，讓自己放鬆。",
            keywords: [
              { english: "watch movies", chinese: "看電影" },
              { english: "relax", chinese: "放鬆" },
            ],
            sampleEnglish:
              "On weekends, I usually watch movies at home. It helps me relax.",
            sampleChinese: "我週末通常在家看電影，這能讓我放鬆。",
          },
          {
            chinese: "和朋友出去吃飯、聊聊天。",
            keywords: [
              { english: "eat out", chinese: "外出吃飯" },
              { english: "catch up", chinese: "聊聊近況" },
            ],
            sampleEnglish:
              "On weekends, I usually eat out with friends and catch up.",
            sampleChinese: "我週末通常和朋友出去吃飯、聊聊近況。",
          },
          {
            chinese: "去散步或運動，保持健康。",
            keywords: [
              { english: "go for a walk", chinese: "散步" },
              { english: "stay healthy", chinese: "保持健康" },
            ],
            sampleEnglish:
              "On weekends, I usually go for a walk to stay healthy.",
            sampleChinese: "我週末通常會去散步，保持健康。",
          },
          {
            chinese: "沒有固定安排，看當天的心情。",
            keywords: [
              { english: "keep my plans flexible", chinese: "保持安排彈性" },
              { english: "in the mood for", chinese: "有心情做" },
            ],
            sampleEnglish:
              "On weekends, I usually keep my plans flexible. It depends on what I'm in the mood for.",
            sampleChinese: "我週末通常不把行程排死，看當天想做什麼。",
          },
        ],
      },
    };
  return {
    questionEnglish: "What interests you about this topic?",
    questionChinese: "這個主題有哪些地方讓你感興趣？",
    guidance: {
      starterEnglish: "I'm interested in this topic because…",
      starterChinese: "我對這個主題有興趣，因為……",
      options: [
        {
          chinese: "最近有相關的經驗，想和人分享。",
          keywords: [
            { english: "recent experience", chinese: "最近的經驗" },
            { english: "share", chinese: "分享" },
          ],
          sampleEnglish:
            "I'm interested in this topic because I had a related experience recently and want to share it.",
          sampleChinese: "我對這個主題有興趣，因為最近有相關經驗，想和人分享。",
        },
        {
          chinese: "生活中可能會遇到，想先練習怎麼表達。",
          keywords: [
            { english: "everyday life", chinese: "日常生活" },
            { english: "express myself", chinese: "表達自己" },
          ],
          sampleEnglish:
            "I'm interested in this topic because it comes up in everyday life. I want to learn how to express myself.",
          sampleChinese:
            "我對這個主題有興趣，因為生活中可能會遇到，我想練習表達。",
        },
        {
          chinese: "對這個主題不太熟悉，想多了解一些。",
          keywords: [
            { english: "curious", chinese: "好奇" },
            { english: "learn more", chinese: "多了解" },
          ],
          sampleEnglish:
            "I'm interested in this topic because I'm curious and want to learn more.",
          sampleChinese: "我對這個主題有興趣，因為很好奇，想多了解一些。",
        },
      ],
    },
  };
}
