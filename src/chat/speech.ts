/**
 * 语音分句器 + 朗读清洗：把 LLM 流式正文切成适合逐句合成的干净短句。
 *
 * 设计：
 *  - 流式增量喂 push()，攒到句界（。！？；…、换行）切一句出去——TTS 逐句
 *    合成/播放流水线的粒度就是它；收尾 flush() 把余量清出去；
 *  - 代码块（``` 围栏）整块不念：跨增量的围栏用状态机剥除，chunk 结尾的
 *    半个围栏标记（1-2 个反引号）先扣住等下一段；
 *  - 太短的句子（"好。"这种）先攒着并进下一句，避免碎句嘴瓢；没有句界的
 *    超长段落在逗号处强切，兜底硬切——合成器不吃无限长输入；
 *  - 行内 markdown（粗斜体/行内码/链接/标题号）在出句前剥成可读文本，
 *    链接只念文字、裸 URL 念「链接」。
 */

// ---- 可调常量 ----
/** 句界字符（含中英标点与换行；顿号不算——列举中间别断） */
const SENTENCE_END = new Set([..."。！？；!?;…\n"]);
/** 清洗后短于这个字数的句子先攒着并进下一句（碎句合并） */
const MIN_SENTENCE = 4;
/** 无句界时攒到这个长度强切（优先在逗号处，其次硬切） */
const MAX_SENTENCE = 60;
/** 强切时回找逗号的字符集 */
const COMMA = new Set([..."，,、"]);

/** 行内 markdown → 可读文本（逐句出稿前调用） */
export function sanitizeSpeech(text: string): string {
  return (
    text
      // 行内代码保留内容（围栏级代码块已由分句器剥除）
      .replace(/`([^`]*)`/g, "$1")
      // 图片整个不念；链接只念方括号里的文字
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 裸 URL 念「链接」（一串字母斜杠念出来是灾难）
      .replace(/https?:\/\/\S+/g, "链接")
      // 标题井号 / 引用尖括号 / 加粗斜体删除线 / 表格竖线
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/[*_~#>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 流式语音分句器：一轮回复挂一个实例（状态含未闭合围栏与待并短句） */
export class SpeechSplitter {
  /** 未决原始输入（可能以半个围栏标记结尾） */
  private raw = "";
  /** 已剥围栏的待切正文 */
  private plain = "";
  /** 在代码块里（内容丢弃不念） */
  private inCode = false;
  /** 已成句但太短，等着并进下一句的原文 */
  private pending = "";

  /** 喂一段流式增量，返回本次切出的可念句子（可能为空） */
  push(chunk: string): string[] {
    this.raw += chunk;
    this.absorb(false);
    return this.cut(false);
  }

  /** 收尾：把余量全部清出（未闭合代码块丢弃） */
  flush(): string[] {
    this.absorb(true);
    return this.cut(true);
  }

  /** 围栏剥除：raw → plain。final 时不再扣半个围栏、未闭合围栏内容丢弃 */
  private absorb(final: boolean): void {
    for (;;) {
      if (this.inCode) {
        const end = this.raw.indexOf("```");
        if (end === -1) {
          if (final) this.raw = "";
          return; // 围栏未闭合：流式中等后续增量
        }
        this.raw = this.raw.slice(end + 3);
        this.inCode = false;
      } else {
        const start = this.raw.indexOf("```");
        if (start === -1) {
          // 结尾可能是断在 chunk 边界的半个围栏标记，扣住 1-2 个反引号
          const hold = final ? 0 : (/`{1,2}$/.exec(this.raw)?.[0].length ?? 0);
          const take = this.raw.length - hold;
          this.plain += this.raw.slice(0, take);
          this.raw = this.raw.slice(take);
          return;
        }
        this.plain += this.raw.slice(0, start);
        this.raw = this.raw.slice(start + 3);
        this.inCode = true;
      }
    }
  }

  /** 从 plain 切句：句界切 + 超长强切 + 碎句合并。final 时余量全出 */
  private cut(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      // 找最早句界
      let cutAt = -1;
      for (let i = 0; i < this.plain.length; i++) {
        if (SENTENCE_END.has(this.plain[i])) {
          cutAt = i + 1; // 含句界标点
          break;
        }
      }
      if (cutAt === -1) {
        // 无句界：超长则在逗号处强切（回找），否则硬切
        if (this.pending.length + this.plain.length > MAX_SENTENCE) {
          let comma = -1;
          for (let i = this.plain.length - 1; i >= 0; i--) {
            if (COMMA.has(this.plain[i])) {
              comma = i + 1;
              break;
            }
          }
          cutAt = comma > 0 ? comma : this.plain.length;
        } else {
          break; // 继续攒
        }
      }
      const piece = this.pending + this.plain.slice(0, cutAt);
      this.plain = this.plain.slice(cutAt);
      this.pending = "";
      const spoken = sanitizeSpeech(piece);
      if (spoken.length >= MIN_SENTENCE) {
        out.push(spoken);
      } else if (spoken.length > 0) {
        this.pending = piece; // 碎句攒着并进下一句
      }
    }
    if (final) {
      const tail = sanitizeSpeech(this.pending + this.plain);
      this.pending = "";
      this.plain = "";
      if (tail) out.push(tail);
    }
    return out;
  }
}
