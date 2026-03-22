import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { chatMessages, conversationId, isChatLoading, overlayData } from '../../state';
import { sendChatMessage } from '../../api-client';
import { richContent } from '../../state';

export default function AskGuruTab() {
  const [input, setInput] = useState('');
  const [followUps, setFollowUps] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const data = overlayData.value;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.value.length]);

  // Show socratic prompts as initial suggestions if no chat yet
  const prompts = richContent.value?.socratic_prompts ?? [];

  async function handleSend(question: string) {
    if (!question.trim() || !data) return;

    const userMsg = { role: 'user' as const, content: question.trim() };
    chatMessages.value = [...chatMessages.value, userMsg];
    setInput('');
    setFollowUps([]);
    isChatLoading.value = true;

    try {
      const response = await sendChatMessage(
        data.id,
        question.trim(),
        chatMessages.value,
        conversationId.value ?? undefined,
      );

      chatMessages.value = [
        ...chatMessages.value,
        { role: 'assistant', content: response.response },
      ];
      conversationId.value = response.conversation_id;
      setFollowUps(response.follow_up_prompts || []);
    } catch (e) {
      chatMessages.value = [
        ...chatMessages.value,
        { role: 'assistant', content: 'Sorry, I had trouble answering that. Please try again.' },
      ];
    } finally {
      isChatLoading.value = false;
    }
  }

  return (
    <div class="guru-chat">
      <div class="guru-chat-messages">
        {chatMessages.value.length === 0 && prompts.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '8px' }}>
              Try asking:
            </div>
            {prompts.map((prompt, i) => (
              <div
                key={i}
                class="guru-socratic-prompt"
                onClick={() => handleSend(prompt)}
              >
                {prompt}
              </div>
            ))}
          </div>
        )}

        {chatMessages.value.map((msg, i) => (
          <div key={i} class={`guru-chat-message ${msg.role}`}>
            {msg.content}
          </div>
        ))}

        {isChatLoading.value && (
          <div class="guru-chat-message assistant" style={{ opacity: 0.6 }}>
            Thinking...
          </div>
        )}

        {followUps.length > 0 && !isChatLoading.value && (
          <div class="guru-follow-up">
            {followUps.map((f, i) => (
              <button key={i} class="guru-follow-up-chip" onClick={() => handleSend(f)}>
                {f}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div class="guru-chat-input-row">
        <input
          class="guru-chat-input"
          type="text"
          placeholder="Ask Guru about this article..."
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(input);
            }
          }}
        />
        <button
          class="guru-chat-send"
          disabled={!input.trim() || isChatLoading.value}
          onClick={() => handleSend(input)}
        >
          Send
        </button>
      </div>
    </div>
  );
}
