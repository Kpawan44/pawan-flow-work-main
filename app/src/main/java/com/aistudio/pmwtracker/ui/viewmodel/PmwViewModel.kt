package com.aistudio.pmwtracker.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aistudio.pmwtracker.ai.model.ChatMessage
import com.aistudio.pmwtracker.ai.model.ChatSender
import com.aistudio.pmwtracker.ai.service.GeminiAutomationService
import com.aistudio.pmwtracker.data.repository.PmwRepository
import com.aistudio.pmwtracker.model.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID

data class PmwUiState(
    val searchQuery: String = "",
    val selectedDepartmentFilter: Department? = null,
    val selectedStatusFilter: JobCardStatus? = null,
    val isTransferDialogOpen: Boolean = false,
    val activeTransferJobCard: JobCard? = null,
    val isCreateJobDialogOpen: Boolean = false,
    val isSearchActive: Boolean = false
)

class PmwViewModel(
    private val repository: PmwRepository
) : ViewModel() {

    private val geminiService = GeminiAutomationService(repository)

    private val initialWelcomeMessage = ChatMessage(
        id = "welcome-ai-msg",
        sender = ChatSender.AI,
        content = "👋 **Welcome to PMW Plant AI Automation Flow**\n\nI am your intelligent manufacturing copilot connected directly to your shop-floor Room database.\n\nHere is what I can execute for you:\n• **Auto-shift materials**: *'Move 500 kgs of JC-2026-0101 to Heat Treatment'*\n• **Auto-generate Job Cards**: *'Create job card for 1200 pcs Hex Bolts for Bosch'*\n• **Audit line bottlenecks**: *'Analyze shop-floor bottlenecks and delayed orders'*\n• **Subcontractor orders**: *'Outsource 350 pcs to Supreme Electroplaters'*\n\nTap any quick action below or type a natural language instruction!",
        timestamp = System.currentTimeMillis()
    )

    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(listOf(initialWelcomeMessage))
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages.asStateFlow()

    private val _isAiThinking = MutableStateFlow(false)
    val isAiThinking: StateFlow<Boolean> = _isAiThinking.asStateFlow()

    private val _uiState = MutableStateFlow(PmwUiState())
    val uiState: StateFlow<PmwUiState> = _uiState.asStateFlow()

    val allJobCards: StateFlow<List<JobCard>> = repository.allJobCards
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allMovements: StateFlow<List<MaterialMovement>> = repository.allMovements
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val pendingMovements: StateFlow<List<MaterialMovement>> = repository.pendingMovements
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allTransfers: StateFlow<List<ProcessTransfer>> = repository.allTransfers
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allOutsourceOrders: StateFlow<List<OutsourceOrder>> = repository.allOutsourceOrders
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        viewModelScope.launch {
            allJobCards.collect { cards ->
                repository.seedInitialDataIfEmpty(cards.size)
            }
        }
    }

    val filteredJobCards: StateFlow<List<JobCard>> = combine(
        allJobCards,
        _uiState
    ) { cards, state ->
        cards.filter { card ->
            val matchesSearch = state.searchQuery.isEmpty() ||
                    card.jobCardNo.contains(state.searchQuery, ignoreCase = true) ||
                    card.itemName.contains(state.searchQuery, ignoreCase = true) ||
                    card.partyName.contains(state.searchQuery, ignoreCase = true) ||
                    card.orderNo.contains(state.searchQuery, ignoreCase = true)

            val matchesDept = state.selectedDepartmentFilter == null ||
                    card.currentDepartment == state.selectedDepartmentFilter

            val matchesStatus = state.selectedStatusFilter == null ||
                    card.status == state.selectedStatusFilter

            matchesSearch && matchesDept && matchesStatus
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun setDepartmentFilter(dept: Department?) {
        _uiState.update { it.copy(selectedDepartmentFilter = dept) }
    }

    fun setStatusFilter(status: JobCardStatus?) {
        _uiState.update { it.copy(selectedStatusFilter = status) }
    }

    fun openTransferDialog(jobCard: JobCard) {
        _uiState.update { it.copy(isTransferDialogOpen = true, activeTransferJobCard = jobCard) }
    }

    fun closeTransferDialog() {
        _uiState.update { it.copy(isTransferDialogOpen = false, activeTransferJobCard = null) }
    }

    fun openCreateJobDialog() {
        _uiState.update { it.copy(isCreateJobDialogOpen = true) }
    }

    fun closeCreateJobDialog() {
        _uiState.update { it.copy(isCreateJobDialogOpen = false) }
    }

    fun toggleSearch() {
        _uiState.update { it.copy(isSearchActive = !it.isSearchActive, searchQuery = "") }
    }

    fun createJobCard(jobCard: JobCard) {
        viewModelScope.launch {
            repository.saveJobCard(jobCard)
            closeCreateJobDialog()
        }
    }

    fun transferMaterial(
        toDept: Department,
        quantity: Double,
        operator: String,
        remarks: String
    ) {
        val currentCard = _uiState.value.activeTransferJobCard ?: return
        viewModelScope.launch {
            repository.transferMaterial(
                jobCardNo = currentCard.jobCardNo,
                fromDept = currentCard.currentDepartment,
                toDept = toDept,
                quantity = quantity,
                operatorName = operator,
                remarks = remarks
            )

            // Update JobCard current department and remaining quantity
            val updated = currentCard.copy(
                currentDepartment = toDept,
                status = JobCardStatus.IN_PROCESS,
                updatedAt = System.currentTimeMillis()
            )
            repository.saveJobCard(updated)
            closeTransferDialog()
        }
    }

    fun acceptMovement(movement: MaterialMovement) {
        viewModelScope.launch {
            repository.acceptMovement(movement.movementId, movement, "Supervisor")
        }
    }

    fun rejectMovement(movement: MaterialMovement, reason: String) {
        viewModelScope.launch {
            repository.rejectMovement(movement.movementId, movement, reason)
        }
    }

    fun sendAiMessage(promptText: String) {
        val trimmed = promptText.trim()
        if (trimmed.isEmpty() || _isAiThinking.value) return

        val userMessage = ChatMessage(
            id = UUID.randomUUID().toString(),
            sender = ChatSender.USER,
            content = trimmed,
            timestamp = System.currentTimeMillis()
        )

        val thinkingPlaceholder = ChatMessage(
            id = "thinking-placeholder",
            sender = ChatSender.AI,
            content = "Analyzing factory database and preparing automated actions...",
            timestamp = System.currentTimeMillis(),
            isThinking = true
        )

        _chatMessages.update { it + userMessage + thinkingPlaceholder }
        _isAiThinking.value = true

        viewModelScope.launch {
            try {
                val (replyText, executedActions) = geminiService.processUserPrompt(trimmed)
                val aiMessage = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    sender = ChatSender.AI,
                    content = replyText,
                    timestamp = System.currentTimeMillis(),
                    isThinking = false,
                    actions = executedActions
                )

                _chatMessages.update { list ->
                    list.filter { it.id != "thinking-placeholder" } + aiMessage
                }
            } catch (e: Exception) {
                val errorMessage = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    sender = ChatSender.AI,
                    content = "⚠️ Execution error: ${e.localizedMessage ?: "Unknown operational fault"}. Please retry.",
                    timestamp = System.currentTimeMillis(),
                    isThinking = false
                )
                _chatMessages.update { list ->
                    list.filter { it.id != "thinking-placeholder" } + errorMessage
                }
            } finally {
                _isAiThinking.value = false
            }
        }
    }

    fun clearAiChat() {
        _chatMessages.value = listOf(initialWelcomeMessage)
    }
}
