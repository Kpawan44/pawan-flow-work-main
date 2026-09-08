package com.aistudio.pmwtracker.ai.model

enum class ChatSender {
    USER, AI, SYSTEM
}

data class ChatMessage(
    val id: String,
    val sender: ChatSender,
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val isThinking: Boolean = false,
    val actions: List<ExecutedAction> = emptyList()
)
