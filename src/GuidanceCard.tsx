import { useId, useState } from "react";
import type { Guidance } from "../shared/schema";

export function GuidanceCard({ guidance }: { guidance: Guidance }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const id = useId();
  const option = guidance.options[selected ?? 0];
  return (
    <section
      className="guidance-card"
      aria-label="回答引導"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="guidance-heading">
        <span>✦ 回答引導</span>
        <small>先想內容，再試著說英文</small>
      </div>
      <div className="guidance-starter">
        <small>試著接著說</small>
        <p lang="en">{guidance.starterEnglish}</p>
        <span>{guidance.starterChinese}</span>
      </div>
      <p className="guidance-instruction">想不到內容時，可以選一個中文方向：</p>
      <div className="guidance-options" role="group" aria-label="中文回答方向">
        {guidance.options.map((item, index) => (
          <button
            type="button"
            key={item.chinese}
            aria-label={`回答方向：${item.chinese}`}
            aria-pressed={selected === index}
            onClick={() => setSelected(selected === index ? null : index)}
          >
            <span>{selected === index ? "●" : "○"}</span>
            {item.chinese}
          </button>
        ))}
      </div>
      <div className="guidance-footer">
        <small>也可以說自己的答案，選擇方向不會填入英文。</small>
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls={id}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "收起進階引導" : "進階引導"}
        </button>
      </div>
      {advanced && (
        <div className="guidance-advanced" id={id}>
          <small>參考方向：{option.chinese}</small>
          <h4>可以用的關鍵字</h4>
          <div className="guidance-keywords">
            {option.keywords.map((keyword, index) => (
              <span key={index}>
                <strong lang="en">{keyword.english}</strong> · {keyword.chinese}
              </span>
            ))}
          </div>
          <h4>完整參考回答</h4>
          <p lang="en">{option.sampleEnglish}</p>
          <p className="muted">{option.sampleChinese}</p>
          <small>參考後，試著用自己的經驗回答。</small>
        </div>
      )}
    </section>
  );
}
