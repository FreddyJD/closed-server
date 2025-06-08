const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

// Initialize Claude
const anthropic = new Anthropic({
    apiKey: config.claude.apiKey || 'your-claude-api-key-here'
});

// Check if Claude is configured
function isConfigured() {
    return !!config.claude.apiKey;
}

// Generate smart battle card using AI
async function generateSmartCard(transcriptions, forceGeneration = false) {
    const conversationText = transcriptions
        .map(t => `${t.speaker ? `Speaker ${t.speaker}:` : ''} ${t.text}`)
        .join('\n');
    
    const prompt = forceGeneration ? `
You are a sales AI assistant helping a salesperson analyze selected conversation lines.

SELECTED CONVERSATION LINES:
${conversationText}

The salesperson has manually selected these lines and wants you to generate a battle card. You MUST create a helpful action plan even if the situation is not critical.

Analyze these lines and create a battle card that helps the salesperson respond effectively. Look for:
- Any objection or concern (even minor ones)
- Questions or information requests
- Buying signals or interest indicators
- Opportunities to provide value
- Technical discussions
- Any situation where guidance would help

Respond with this EXACT JSON format (use ONLY single quotes in HTML content):
{
  "detected": true,
  "id": "manual-${Date.now()}",
  "title": "Brief description of the situation",
  "type": "pricing|technical|timeline|objection|opportunity|question",
  "response": {
    "title": "🎯 [SITUATION] - Action Plan",
    "content": "<h4>🎯 IMMEDIATE ACTIONS:</h4><ol><li><strong>Action:</strong> What to do or say</li><li><strong>Follow-up:</strong> Next step to take</li></ol><h4>📋 KEY POINTS:</h4><ul><li>Important insight or fact</li><li>Helpful context or approach</li></ul><p><strong>💡 CLOSE:</strong> Specific question to ask or next step</p>"
  }
}

CRITICAL JSON SAFETY RULES:
- Use ONLY single quotes inside HTML content (never double quotes)
- Avoid apostrophes - write out full words (dont → do not, I will → I will)
- Keep content on ONE line (no line breaks)
- No special characters that break JSON

You MUST generate a helpful card. Be creative and find value in the selected lines.

Respond ONLY with valid JSON.
` : `
You are a sales AI that detects ONLY the most important moments in sales conversations.

CONVERSATION:
${conversationText}

Analyze this conversation and determine if there is ONE clear, actionable opportunity that requires immediate attention from the salesperson.

Only respond if you detect:
- A clear objection (pricing, timeline, technical concerns)
- A buying signal (interest, evaluation criteria)  
- A specific question that needs expert response
- An opportunity to advance the sale

If you detect something important, respond with this EXACT JSON format (use ONLY single quotes in HTML content):
{
  "detected": true,
  "id": "ai-${Date.now()}",
  "title": "Brief description of what was detected",
  "type": "pricing",
  "response": {
    "title": "🎯 Pricing Objection - Action Plan",
    "content": "<h4>🎯 IMMEDIATE ACTIONS:</h4><ol><li><strong>Action:</strong> Address the pricing concern directly</li><li><strong>Follow-up:</strong> Provide value justification</li></ol><h4>📋 KEY POINTS:</h4><ul><li>Understand their budget constraints</li><li>Highlight ROI and value proposition</li></ul><p><strong>💡 CLOSE:</strong> What budget range works best for you?</p>"
  }
}

VALID TYPES: pricing, technical, timeline, objection, opportunity, question

If nothing important is detected, respond:
{
  "detected": false,
  "reason": "Brief explanation why no card is needed"
}

CRITICAL JSON SAFETY RULES:
- Use ONLY single quotes inside HTML content (never double quotes)
- Avoid apostrophes - write out full words (dont → do not, I'll → I will)
- Keep content on ONE line (no line breaks)
- No special characters that break JSON

Be very selective. Most conversations do not need cards. Only flag truly important moments.

Respond ONLY with valid JSON.
`;

    let response;
    try {
        response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 800,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        });
        
        let responseText = response.content[0].text.trim();
        console.log('Claude response:', responseText);
        
        // Enhanced cleanup for common JSON issues
        responseText = responseText
            .replace(/[\r\n]+/g, ' ')  // Remove line breaks
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .replace(/'/g, "'")        // Replace smart quotes with regular apostrophes
            .replace(/'/g, "'")        // Replace other smart quotes
            .replace(/"/g, '"')        // Replace smart double quotes
            .replace(/"/g, '"')        // Replace other smart double quotes
            .replace(/'/g, "\\'")      // Escape remaining apostrophes
            .trim();
        
        const analysis = JSON.parse(responseText);
        
        if (analysis.detected) {
            return analysis; // Return the card as-is (Claude built the HTML)
        } else {
            console.log('No card needed:', analysis.reason);
            return null; // No card needed
        }
        
    } catch (error) {
        console.error('Claude API error:', error);
        if (response?.content?.[0]?.text) {
            console.error('Raw response that failed to parse:', response.content[0].text);
        }
        throw new Error('AI analysis failed: ' + error.message);
    }
}

module.exports = {
    isConfigured,
    generateSmartCard
}; 