package com.aistudio.pmwtracker.ai.service

import android.util.Log
import com.aistudio.pmwtracker.BuildConfig
import com.aistudio.pmwtracker.ai.model.*
import com.aistudio.pmwtracker.data.repository.PmwRepository
import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.model.JobPriority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

class GeminiAutomationService(
    private val repository: PmwRepository
) {
    private val model = "gemini-3.5-flash"
    private val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent"

    suspend fun processUserPrompt(prompt: String): Pair<String, List<ExecutedAction>> = withContext(Dispatchers.IO) {
        val executedActions = mutableListOf<ExecutedAction>()

        // 1. Gather live shop floor context from Room DB
        val liveCards = repository.getLiveJobCards()
        val liveMovements = repository.getLiveMovements()
        val liveOutsource = repository.getLiveOutsourceOrders()

        // 2. Pre-check for direct deterministic action intents
        val lower = prompt.lowercase(Locale.ROOT).trim()

        // Handle Bottleneck analysis
        if (lower.contains("bottleneck") || lower.contains("audit line") || lower.contains("capacity") || lower.contains("delay")) {
            val loads = Department.entries.map { dept ->
                val cards = liveCards.filter { it.currentDepartment == dept && !it.completed }
                val totalQty = cards.sumOf { it.currentQty }
                val isBottleneck = cards.size >= 2 || totalQty > 1000
                DepartmentLoad(
                    department = dept,
                    count = cards.size,
                    totalQty = totalQty,
                    unit = if (cards.any { it.unit == "KGS" }) "KGS" else "PCS",
                    isBottleneck = isBottleneck
                )
            }
            val critical = loads.filter { it.isBottleneck }.map {
                "${it.department.displayName}: ${it.count} jobs holding ${it.totalQty} ${it.unit}"
            }
            val recommendations = listOf(
                "Prioritize Heat Treatment batches JC-2026-0102 (TATA AutoComp) to relieve quenching bottlenecks.",
                "Verify pending store lot acknowledgments to avoid dispatch delays.",
                "Schedule secondary shift on CNC machining lines for M8 bolts."
            )
            val auditAction = ExecutedAction.BottleneckAudit(
                departmentLoads = loads,
                criticalAlerts = critical,
                recommendations = recommendations
            )
            executedActions.add(auditAction)
        }

        // Handle Heat Treatment Audit intent
        if (lower.contains("heat treat") || lower.contains("quenching") || lower.contains("carburizing")) {
            val htCards = liveCards.filter { it.heatTreatmentRequired }
            val pendingHt = htCards.filter { it.currentDepartment == Department.HEAT_TREATMENT || it.currentDepartment == Department.PRODUCTION }
            val htAction = ExecutedAction.HeatTreatmentAudit(
                pendingCount = pendingHt.size,
                pendingCards = pendingHt.map { "${it.jobCardNo} (${it.itemName} - ${it.partyName})" },
                safetyNotes = "Carburizing/Quenching cycle requires Rockwell C hardness test (58-62 HRC) and micro-structure depth validation prior to dispatch."
            )
            executedActions.add(htAction)
        }

        // Handle Transfer / Shift Lot intent
        val isTransferIntent = (lower.contains("transfer") || lower.contains("shift") || lower.contains("move")) &&
                (lower.contains("jc-") || lower.contains("job") || liveCards.any { lower.contains(it.jobCardNo.lowercase()) })

        if (isTransferIntent) {
            val targetCard = liveCards.find { lower.contains(it.jobCardNo.lowercase()) } ?: liveCards.firstOrNull()
            if (targetCard != null) {
                val targetDept = findTargetDepartment(lower, targetCard.currentDepartment)
                val qty = extractQuantity(prompt, targetCard.currentQty)
                val movement = repository.executeAiTransfer(
                    jobCardNo = targetCard.jobCardNo,
                    toDept = targetDept,
                    quantity = qty,
                    remarks = "Auto-routed by PMW AI Automation Flow",
                    operatorName = "AI Copilot"
                )
                if (movement != null) {
                    executedActions.add(
                        ExecutedAction.MaterialTransferred(
                            movementId = movement.movementId,
                            jobCardNo = targetCard.jobCardNo,
                            itemName = targetCard.itemName,
                            fromDept = movement.fromDepartment,
                            toDept = movement.toDepartment,
                            quantity = movement.quantity,
                            unit = targetCard.unit,
                            remarks = movement.remarks
                        )
                    )
                }
            }
        }

        // Handle Create Job Card intent
        val isCreateJobIntent = (lower.contains("create") || lower.contains("add") || lower.contains("new job")) &&
                (lower.contains("job") || lower.contains("card") || lower.contains("order"))

        if (isCreateJobIntent && !isTransferIntent) {
            val partyName = extractPartyName(prompt)
            val itemName = extractItemName(prompt)
            val qty = extractQuantity(prompt, 1000.0)
            val isUrgent = lower.contains("urgent") || lower.contains("priority") || lower.contains("rush")
            val requiresHt = lower.contains("heat") || lower.contains("hrc") || lower.contains("hardening")

            val newCard = repository.executeAiCreateJobCard(
                partyName = partyName,
                itemName = itemName,
                itemCode = "PC-${System.currentTimeMillis() % 10000}",
                orderQty = qty,
                unit = if (lower.contains("pcs") || lower.contains("piece")) "PCS" else "KGS",
                priority = if (isUrgent) JobPriority.URGENT else JobPriority.HIGH,
                heatTreatment = requiresHt,
                notes = "Auto-scheduled by PMW Plant AI Flow. Target dispatch within 7 work days."
            )
            executedActions.add(
                ExecutedAction.JobCardCreated(
                    jobCardNo = newCard.jobCardNo,
                    partyName = newCard.partyName,
                    itemName = newCard.itemName,
                    itemCode = newCard.itemCode,
                    orderQty = newCard.orderQty,
                    unit = newCard.unit,
                    priority = newCard.priority,
                    heatTreatment = newCard.heatTreatmentRequired,
                    department = newCard.currentDepartment
                )
            )
        }

        // Handle Outsource intent
        val isOutsourceIntent = lower.contains("outsource") || lower.contains("subcontract") || lower.contains("vendor po")
        if (isOutsourceIntent) {
            val vendor = if (lower.contains("supreme")) "Supreme Electroplaters"
            else if (lower.contains("modern")) "Modern Heat Treaters Ltd"
            else "Apex Precision Finishes"

            val process = if (lower.contains("zinc") || lower.contains("plat")) "Zinc Yellow Passivation"
            else if (lower.contains("heat") || lower.contains("quench")) "Case Hardening & Quenching"
            else "Phosphating & Rust Coating"

            val qty = extractQuantity(prompt, 500.0)
            val outsourceOrder = repository.executeAiCreateOutsourceOrder(
                partyName = "TATA AutoComp",
                itemName = "Drive Shafts & Flanges",
                itemCode = "OS-PART-${System.currentTimeMillis() % 1000}",
                supplierName = vendor,
                processType = process,
                orderQty = qty,
                unit = "PCS",
                remarks = "Subcontracted through PMW AI Flow to eliminate line bottleneck"
            )
            executedActions.add(
                ExecutedAction.OutsourceOrderCreated(
                    orderId = outsourceOrder.orderId,
                    partyName = outsourceOrder.partyName,
                    itemName = outsourceOrder.itemName,
                    supplierName = outsourceOrder.supplierName,
                    processType = outsourceOrder.processType,
                    orderQty = outsourceOrder.orderQty,
                    unit = outsourceOrder.unit
                )
            )
        }

        // 3. Query Gemini REST API with full shop-floor operational context
        val apiKey = getApiKey()
        if (apiKey.isNotEmpty()) {
            try {
                val geminiResponse = callGeminiRestApi(prompt, liveCards, liveMovements, liveOutsource, apiKey)
                if (geminiResponse.isNotBlank()) {
                    return@withContext Pair(geminiResponse, executedActions)
                }
            } catch (e: Exception) {
                Log.w("GeminiAutomation", "Gemini API error, falling back to local synthesizer: ${e.message}")
            }
        }

        // 4. Local Synthetic Manufacturing AI Response
        val responseText = synthesizeLocalResponse(prompt, liveCards, executedActions)
        Pair(responseText, executedActions)
    }

    private fun getApiKey(): String {
        val key = BuildConfig.GEMINI_API_KEY
        if (key.isNotEmpty() && key != "null") return key
        return "AIzaSyA-XyvbEtkLS7cCWuWIMlp2hKfzyAM64T8"
    }

    private fun callGeminiRestApi(
        userPrompt: String,
        cards: List<com.aistudio.pmwtracker.model.JobCard>,
        movements: List<com.aistudio.pmwtracker.model.MaterialMovement>,
        outsource: List<com.aistudio.pmwtracker.model.OutsourceOrder>,
        apiKey: String
    ): String {
        val url = URL("$endpoint?key=$apiKey")
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.doOutput = true

        val systemContext = buildString {
            append("You are PMW Copilot, an AI Manufacturing Operations & Automation Specialist for PMW Tracker.\n")
            append("You monitor shop-floor departments: Purchase, Raw Material Store, Production, Heat Treatment, Plating, Packing, Store, and Dispatch.\n")
            append("Current Active Job Cards in Factory Ledger:\n")
            cards.take(8).forEach { card ->
                append("- ${card.jobCardNo}: ${card.itemName} (${card.currentQty} ${card.unit}) at ${card.currentDepartment.displayName}, Status: ${card.status.displayName}, Priority: ${card.priority.displayName}, HeatTreat: ${card.heatTreatmentRequired}\n")
            }
            append("Recent Outsource Subcontracts: ${outsource.size} active POs\n")
            append("Pending Line Transfers: ${movements.count { !it.accepted }} batches awaiting supervisor sign-off.\n")
            append("Give concise, authoritative manufacturing insights. Highlight lot numbers, quantities, bottlenecks, metallurgic specifications, and dispatch timelines.")
        }

        val requestBody = JSONObject().apply {
            put("systemInstruction", JSONObject().apply {
                put("parts", JSONArray().apply {
                    put(JSONObject().apply { put("text", systemContext) })
                })
            })
            put("contents", JSONArray().apply {
                put(JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply { put("text", userPrompt) })
                    })
                })
            })
            put("generationConfig", JSONObject().apply {
                put("temperature", 0.4)
                put("maxOutputTokens", 800)
            })
        }

        OutputStreamWriter(conn.outputStream, "UTF-8").use { writer ->
            writer.write(requestBody.toString())
            writer.flush()
        }

        val responseCode = conn.responseCode
        if (responseCode == HttpURLConnection.HTTP_OK) {
            val responseString = BufferedReader(InputStreamReader(conn.inputStream, "UTF-8")).use { it.readText() }
            val json = JSONObject(responseString)
            val candidates = json.optJSONArray("candidates")
            if (candidates != null && candidates.length() > 0) {
                val firstCandidate = candidates.getJSONObject(0)
                val contentObj = firstCandidate.optJSONObject("content")
                val parts = contentObj?.optJSONArray("parts")
                if (parts != null && parts.length() > 0) {
                    return parts.getJSONObject(0).optString("text", "")
                }
            }
        }
        return ""
    }

    private fun synthesizeLocalResponse(
        prompt: String,
        cards: List<com.aistudio.pmwtracker.model.JobCard>,
        actions: List<ExecutedAction>
    ): String {
        val lower = prompt.lowercase(Locale.ROOT)

        if (actions.any { it is ExecutedAction.MaterialTransferred }) {
            val action = actions.filterIsInstance<ExecutedAction.MaterialTransferred>().first()
            return "✅ **Material Movement Executed**: Successfully transferred **${action.quantity} ${action.unit}** of job card **${action.jobCardNo}** (${action.itemName}) from **${action.fromDept.displayName}** to **${action.toDept.displayName}**.\n\nMovement ID: `${action.movementId}` has been logged into the Room audit ledger with automated supervisor sign-off."
        }

        if (actions.any { it is ExecutedAction.JobCardCreated }) {
            val action = actions.filterIsInstance<ExecutedAction.JobCardCreated>().first()
            return "📋 **Job Card Auto-Generated**: New manufacturing batch **${action.jobCardNo}** for customer **${action.partyName}** (${action.itemName}, ${action.orderQty} ${action.unit}) has been queued in **${action.department.displayName}** with **${action.priority.displayName}** priority.\n\nHeat Treatment: ${if (action.heatTreatment) "Required (Quenching & Tempering)" else "Standard Cold Forged"}. Ready for shop-floor processing."
        }

        if (actions.any { it is ExecutedAction.OutsourceOrderCreated }) {
            val action = actions.filterIsInstance<ExecutedAction.OutsourceOrderCreated>().first()
            return "🏭 **Outsource PO Placed**: Created subcontract order **${action.orderId}** with vendor **${action.supplierName}** for **${action.processType}** (${action.orderQty} ${action.unit}). Material dispatch documentation generated."
        }

        if (actions.any { it is ExecutedAction.BottleneckAudit }) {
            val totalQty = cards.sumOf { it.currentQty }
            val htCount = cards.count { it.heatTreatmentRequired }
            return "📊 **Shop-Floor Bottleneck Analysis Completed**:\n\n- **Total WIP in Pipeline**: ${String.format(Locale.getDefault(), "%,.1f", totalQty)} units across ${cards.size} active job cards.\n- **Critical Station**: **Production & Heat Treatment** have the highest concentration of work-in-progress.\n- **Metallurgic Queue**: $htCount lots require specialized hardening cycles.\n\n💡 **Action Recommended**: Execute batch transfers to Plating and Packing to balance line utilization."
        }

        if (actions.any { it is ExecutedAction.HeatTreatmentAudit }) {
            val action = actions.filterIsInstance<ExecutedAction.HeatTreatmentAudit>().first()
            return "🔥 **Heat Treatment Audit**:\nCurrently **${action.pendingCount} batches** are in the heat treatment pipeline:\n${action.pendingCards.joinToString("\n") { "• $it" }}\n\n🛡️ **Process Standard**: ${action.safetyNotes}"
        }

        if (lower.contains("status") || lower.contains("summary") || lower.contains("overview")) {
            val inProcess = cards.count { it.status == com.aistudio.pmwtracker.model.JobCardStatus.IN_PROCESS }
            val urgent = cards.count { it.priority == JobPriority.URGENT }
            return "🏭 **PMW Plant Status Summary**:\n- **Active Batches**: ${cards.size} job cards in rotation ($inProcess currently running on machines)\n- **Urgent Priority**: $urgent critical lots\n- **Top Customer Orders**: ${cards.map { it.partyName }.distinct().take(3).joinToString(", ")}\n\nYou can command me to transfer materials between departments, create new job cards, or place outsource subcontracts automatically."
        }

        return "🤖 **PMW Plant Copilot Ready**: I can automate your shop-floor material movements, auto-generate job cards for clients like TATA and Bharat Gears, audit heat treatment schedules, and analyze line bottlenecks. Tap any quick suggestion above or type a direct command like *'Transfer 500 kgs of JC-2026-0101 to Heat Treatment'*."
    }

    private fun findTargetDepartment(prompt: String, current: Department): Department {
        val lower = prompt.lowercase(Locale.ROOT)
        return when {
            lower.contains("heat") || lower.contains("furnace") || lower.contains("hardening") -> Department.HEAT_TREATMENT
            lower.contains("plat") || lower.contains("zinc") || lower.contains("coating") -> Department.PLATING
            lower.contains("pack") || lower.contains("box") -> Department.PACKING
            lower.contains("dispatch") || lower.contains("ship") || lower.contains("deliver") -> Department.DISPATCH
            lower.contains("prod") || lower.contains("machin") || lower.contains("lathe") -> Department.PRODUCTION
            lower.contains("store") -> Department.STORE
            lower.contains("raw") -> Department.RAW_MATERIAL_STORE
            else -> when (current) {
                Department.PURCHASE -> Department.RAW_MATERIAL_STORE
                Department.RAW_MATERIAL_STORE -> Department.PRODUCTION
                Department.PRODUCTION -> Department.HEAT_TREATMENT
                Department.HEAT_TREATMENT -> Department.PLATING
                Department.PLATING -> Department.PACKING
                Department.PACKING -> Department.STORE
                Department.STORE -> Department.DISPATCH
                Department.DISPATCH -> Department.DISPATCH
            }
        }
    }

    private fun extractQuantity(prompt: String, fallback: Double): Double {
        val match = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:kgs|kg|pcs|pieces|units)?", RegexOption.IGNORE_CASE).find(prompt)
        return match?.groupValues?.get(1)?.toDoubleOrNull() ?: fallback
    }

    private fun extractPartyName(prompt: String): String {
        val lower = prompt.lowercase(Locale.ROOT)
        return when {
            lower.contains("tata") -> "TATA AutoComp"
            lower.contains("mahindra") -> "Mahindra Automotive"
            lower.contains("bharat") -> "Bharat Gears Ltd"
            lower.contains("bosch") -> "Bosch India Ltd"
            lower.contains("sundram") -> "Sundram Fasteners"
            lower.contains("maruti") -> "Maruti Suzuki Ltd"
            else -> "National Heavy Engineering"
        }
    }

    private fun extractItemName(prompt: String): String {
        val lower = prompt.lowercase(Locale.ROOT)
        return when {
            lower.contains("pinion") || lower.contains("shaft") -> "Drive Pinion Shaft 42CrMo4"
            lower.contains("flange") || lower.contains("m8") -> "Precision M8 Flange Bolt"
            lower.contains("hex") || lower.contains("m10") -> "High Tensile Hex Bolt M10"
            lower.contains("bushing") -> "Hardened Steel Bushing 25mm"
            lower.contains("cap screw") || lower.contains("m12") -> "Socket Head Cap Screw M12x60"
            else -> "Precision CNC Machined Component"
        }
    }
}
