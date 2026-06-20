export interface StageSettings {
  model: string;
  temperature: number;
  topP: number;
  lockOutput: boolean;
}

export interface StageOutput {
  id: string;
  timestamp: number;
  content: string;
}

export interface Stage {
  id: string;
  prompt: string;
  output: string;
  outputs: StageOutput[];
  activeOutputIndex: number;
  pinnedVersionId?: string;
  history?: any[];
  settings: StageSettings;
}

export interface Chain {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  templateId: string;
  theme: string;
  sessionMeta: Record<string, any>;
  stages: Stage[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  stages: {
    prompt: string;
    settings: StageSettings;
  }[];
}

export const POPULAR_GEMINI_MODELS = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", provider: "google" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", provider: "google" }
];

export const STATIC_OPENROUTER_MODELS = [
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "openrouter" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "openrouter" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "openrouter" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "openrouter" },
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "openrouter" }
];

export const PRESET_TEMPLATES: Template[] = [
  {
    id: "product-spec",
    name: "PRD ➔ Outline ➔ Tasks",
    description: "Convert a feature concept into a complete PRD, technical doc outline, and structured task breakdown.",
    defaultModel: "gemini-3.5-flash",
    stages: [
      {
        prompt: "Create a detailed Product Requirements Document (PRD) for this application idea, detailing the core user value, features, and user search flows.",
        settings: { model: "", temperature: 0.7, topP: 0.9, lockOutput: false }
      },
      {
        prompt: "Analyze the PRD and draft a comprehensive software system architecture outline. Focus on modular component hierarchy, state design, and data schema.",
        settings: { model: "", temperature: 0.6, topP: 0.85, lockOutput: false }
      },
      {
        prompt: "Generate a prioritized, step-by-step developer implementation task list based on the system architecture outline, estimated story points, and testing requirements.",
        settings: { model: "", temperature: 0.5, topP: 0.8, lockOutput: false }
      }
    ]
  },
  {
    id: "content-matrix",
    name: "Research ➔ Blog Draft ➔ Hooks",
    description: "Transform raw ideas or notes into structured research briefs, ready-to-publish drafts, and copy hooks.",
    defaultModel: "gemini-3.5-flash",
    stages: [
      {
        prompt: "Research the primary and secondary topics in this concept. Provide key analogies, historical context, and potential counter-arguments in a structured overview.",
        settings: { model: "", temperature: 0.7, topP: 0.95, lockOutput: false }
      },
      {
        prompt: "Draft a high-converting, deeply educational 800-word blog post based on the research brief. Maintain an engaging, accessible tone with clear headers.",
        settings: { model: "", temperature: 0.8, topP: 0.9, lockOutput: false }
      },
      {
        prompt: "Extract 5 high-impact, swipeable social hooks (suitable for X / Twitter, LinkedIn, and email headlines) designed to capture attention and summarize the blog's core thesis.",
        settings: { model: "", temperature: 0.85, topP: 0.9, lockOutput: false }
      }
    ]
  },
  {
    id: "code-architect",
    name: "Review ➔ Refactor ➔ Tests",
    description: "Audit raw source code, optimize execution, and generate thorough unit testing suites.",
    defaultModel: "gemini-3.1-pro-preview",
    stages: [
      {
        prompt: "Review the input code. Outline key security vulnerability spots, performance bottleneck possibilities, and code readability recommendations.",
        settings: { model: "", temperature: 0.2, topP: 0.8, lockOutput: false }
      },
      {
        prompt: "Refactor the original code into a production-ready, clean TypeScript implementation addressing all identified security and efficiency concerns. Add clear inline documentation.",
        settings: { model: "", temperature: 0.3, topP: 0.85, lockOutput: false }
      },
      {
        prompt: "Produce an exhaustive list of unit tests (using standard Jest/Vitest structure) covering happy path, edge cases, negative tests, and error conditions for the refactored code.",
        settings: { model: "", temperature: 0.2, topP: 0.8, lockOutput: false }
      }
    ]
  }
];
