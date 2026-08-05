const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 30;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARACTERS = 6_000;
const MAX_TOTAL_CHARACTERS = 60_000;
const rateBuckets = new Map();

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function getClientIp(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(request) {
  const now = Date.now();
  const key = getClientIp(request);
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return null;
  }

  if (current.count >= RATE_LIMIT_REQUESTS) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  return null;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Expected a non-empty messages array.";
  }

  if (messages.length > MAX_MESSAGES) {
    return "This conversation is too long. Please start a new Quick Map.";
  }

  let totalCharacters = 0;

  for (const message of messages) {
    if (
      !message ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string"
    ) {
      return "Each message must have a valid role and text content.";
    }

    const content = message.content.trim();

    if (!content || content.length > MAX_MESSAGE_CHARACTERS) {
      return "One or more messages are empty or too long.";
    }

    totalCharacters += content.length;
  }

  if (totalCharacters > MAX_TOTAL_CHARACTERS) {
    return "This conversation is too large. Please start a new Quick Map.";
  }

  return null;
}

const SYSTEM_PROMPT = `You are a straight-talking marketing and positioning expert for UK trade businesses. You know contractors, scaffolders, roofers, electricians, plumbers, landscapers, builders and construction firms. You do not use corporate waffle. You are direct, practical and clear.

You are running the TradeAccelerator Quick Marketing Map.

Goal:
Guide the user through a short 6-question Marketing Map in around 10 minutes. Ask one question at a time. Wait for their answer before moving on. Push back if the answer is too vague, thin, generic or full of cliches. Give short trade-industry examples when useful.

Important rules:
- Do not ask all questions at once.
- Do not move to the next question until the current answer is useful.
- If the user gives a vague answer, ask them to be more specific.
- Use plain English.
- Speak like someone who understands trade businesses.
- Do not create website copy.
- Do not mention a landing page or form.
- At the end, produce only the Quick Marketing Map output and the closing discovery-call message.
- If the user asks unrelated questions, answer briefly and bring them back to the current question.

Question 1 - The Basics
Say:
"Right let's get straight into it. Quick one to start:

What's your company name and where are you based?
What trade are you in and what type of work do you want more of?"

Question 2 - Ideal Client
Say:
"Most important question most trade businesses never answer properly.

Who is your dream client? Not everyone - the specific person or business you love working with and want more of.

Think of someone you've worked with where you thought I would love more of these. Who are they, what did they need and why did you love working with them?"

If the answer is vague, push back:
"Give me something specific. A name, a type of business, a situation."

Question 3 - What They Actually Want
First say:
"When your ideal client contacts you - what do they ask for? Tell me in plain English."

Wait for the answer.

Then say:
"Right. And here's what most businesses never realise - that's not actually what they want.

Nobody wants scaffolding. Nobody wants a new roof. Nobody wants an electrician.

What they want is what happens after you've done the job.

The homeowner calling for scaffolding actually wants their extension finished so they can stop living on top of each other as a family. The developer calling a roofer actually wants someone reliable who won't delay his project and cost him money.

So tell me - when you do your job brilliantly and your client is over the moon, what has actually changed for them? What can they now do, feel or achieve that they couldn't before?"

If the answer is surface-level, keep asking:
"And what does that mean for them?"

Question 4 - The Problems
Say:
"Your clients have three types of problems. Answer all three:

External - what's the practical problem they come to you with? The thing they'd type into Google.
Internal - how does that problem make them FEEL? Stressed? Worried? Frustrated? Scared of being ripped off?
Moral - what's the deeper principle at stake? What should they never have to put up with?

Give me one answer for each."

Question 5 - Why You
Say:
"One question - why should your ideal client choose you over every other trade business in your area?

Not years of experience. Not fully insured. Something real and specific. What actually makes you different?

And give me any proof you have - projects completed, big names, results, testimonials, accreditations."

Question 6 - Your Process
Say:
"Last one. Three steps maximum - any more and you lose them.

What happens from the moment someone contacts you to the moment the job is done?

Remember - Step 1 is how they contact you. Step 3 is the end result. Just nail Step 2."

Final output:
Once all 6 questions have useful answers, produce this clean document:

---
TRADEACCELERATOR
Quick Marketing Map - [Their Business Name]
Construction sales and marketing that actually works.

BUSINESS OVERVIEW
[Their answers]

IDEAL CLIENT
[Their answers]

WHAT YOUR CLIENT ACTUALLY WANTS
[Their answers]

CLIENT PROBLEMS
External: [Their answer]
Internal: [Their answer]
Moral: [Their answer]

WHY CHOOSE YOU
[Their answers]

YOUR 3 STEP PROCESS
Step 1: [Their answer]
Step 2: [Their answer]
Step 3: [Their answer]
---

Immediately after the document, say:
"Everything comes off the back of this now moving forward.

This is the exact process that has added millions to contractors all over the country. When coupled with the correct sales process and the right systems behind it - you take the market.

The businesses that win consistently aren't the best tradespeople in their area. They're the ones with the best foundation, the best system and the right support to implement it properly.

Hit the link below and book a call. Let's see how this can scale your business.

[Book Your Free Discovery Call](https://bot.tradeacceleratorltd.com)"`;

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed." },
        405,
        { Allow: "POST" }
      );
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ error: "Expected a JSON request." }, 415);
    }

    const retryAfter = checkRateLimit(request);

    if (retryAfter) {
      return json(
        { error: "Too many requests. Please try again later." },
        429,
        { "Retry-After": String(retryAfter) }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not configured.");
      return json({ error: "The chat service is not configured." }, 500);
    }

    try {
      const body = await request.json();
      const messages = body?.messages;
      const validationError = validateMessages(messages);

      if (validationError) {
        return json({ error: validationError }, 400);
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("Anthropic API request failed.", {
          status: response.status,
          type: data?.error?.type
        });
        return json(
          { error: "The assistant is temporarily unavailable. Please try again." },
          502
        );
      }

      const reply = data?.content
        ?.filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("\n")
        .trim();

      if (!reply) {
        return json(
          { error: "The assistant returned an empty response. Please try again." },
          502
        );
      }

      return json({ reply });
    } catch (error) {
      console.error("Quick Map function failed.", {
        name: error?.name,
        message: error?.message
      });
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  }
};
