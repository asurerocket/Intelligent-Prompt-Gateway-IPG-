export interface InterceptPromptResult {
  allowed: boolean;
  prompt: string;
  reason?: string;
}

export interface InspectResponseResult {
  allowed: boolean;
  response: string;
  reason?: string;
}

export interface ILLMAdapter {
  getProviderName(): string;
  interceptPrompt(prompt: string): Promise<InterceptPromptResult>;
  inspectResponse(response: string): Promise<InspectResponseResult>;
}

export class GenericLLMAdapter implements ILLMAdapter {
  public constructor(private readonly provider: string) {}

  public getProviderName(): string {
    return this.provider;
  }

  public async interceptPrompt(prompt: string): Promise<InterceptPromptResult> {
    return { allowed: true, prompt };
  }

  public async inspectResponse(response: string): Promise<InspectResponseResult> {
    return { allowed: true, response };
  }
}

export const SupportedProviders = ["copilot", "chatgpt", "claude", "gemini", "cursor", "windsurf"];
