// shared/ai/aiTasks.mjs
// The three AI asks and their output-token budgets: room for the answer, plus room for reasoning
// whenever an attempt does not expect reasoning to be switched off.

/** @typedef {'segmentation' | 'theme' | 'test'} AiTask */

/** @type {readonly AiTask[]} */
export const AI_TASKS = Object.freeze(['segmentation', 'theme', 'test']);

// Reasoning room on top of the answer when thinking cannot be switched off, or only turned down.
// Segmentation 8192 + 24576 = 32768, the same as the old ladder's x4 last rung; theme 8192 + 16384
// is about OpenAI's suggested 25k starting point for reasoning models; test 512 + 3584 = 4096.
export const REASONING_ALLOWANCE = Object.freeze({ segmentation: 24576, theme: 16384, test: 3584 });

/**
 * Output-token cap for one attempt, or undefined for "send no cap". An attempt says through
 * `reasoningOff` whether the model is expected to think.
 *
 * @param {AiTask} task
 * @param {number | undefined} answerTokens what the answer itself needs; falsy sends no cap
 * @param {{ reasoningOff: boolean }} attempt
 * @returns {number | undefined}
 */
export const budgetFor = (task, answerTokens, attempt) => {
    if (!answerTokens) {
        return undefined;
    }
    return answerTokens + (attempt.reasoningOff ? 0 : (REASONING_ALLOWANCE[task] ?? 0));
};
