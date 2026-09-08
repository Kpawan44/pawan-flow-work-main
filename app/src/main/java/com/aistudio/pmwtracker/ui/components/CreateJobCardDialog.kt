package com.aistudio.pmwtracker.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.model.JobCard
import com.aistudio.pmwtracker.model.JobCardStatus
import com.aistudio.pmwtracker.model.JobPriority

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateJobCardDialog(
    onDismiss: () -> Unit,
    onConfirm: (JobCard) -> Unit
) {
    var jobCardNo by remember { mutableStateOf("JC-2026-${(100..999).random()}") }
    var orderNo by remember { mutableStateOf("ORD-${(1000..9999).random()}") }
    var partyName by remember { mutableStateOf("") }
    var itemName by remember { mutableStateOf("") }
    var itemCode by remember { mutableStateOf("") }
    var orderQtyText by remember { mutableStateOf("1000") }
    var unit by remember { mutableStateOf("KGS") }
    var heatTreatmentRequired by remember { mutableStateOf(true) }
    var priority by remember { mutableStateOf(JobPriority.MEDIUM) }
    var selectedDept by remember { mutableStateOf(Department.PRODUCTION) }
    var notes by remember { mutableStateOf("") }

    var deptDropdownExpanded by remember { mutableStateOf(false) }
    var priorityDropdownExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "New Job Card",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = jobCardNo,
                    onValueChange = { jobCardNo = it },
                    label = { Text("Job Card No *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = partyName,
                    onValueChange = { partyName = it },
                    label = { Text("Customer / Party Name *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = itemName,
                    onValueChange = { itemName = it },
                    label = { Text("Item / Component Name *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = itemCode,
                        onValueChange = { itemCode = it },
                        label = { Text("Item Code") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = orderNo,
                        onValueChange = { orderNo = it },
                        label = { Text("Order / PO No") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = orderQtyText,
                        onValueChange = { orderQtyText = it },
                        label = { Text("Order Qty *") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.weight(1.5f)
                    )

                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .align(Alignment.CenterVertically),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        FilterChip(
                            selected = unit == "KGS",
                            onClick = { unit = "KGS" },
                            label = { Text("KG") }
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        FilterChip(
                            selected = unit == "PCS",
                            onClick = { unit = "PCS" },
                            label = { Text("PC") }
                        )
                    }
                }

                // Initial Department Dropdown
                ExposedDropdownMenuBox(
                    expanded = deptDropdownExpanded,
                    onExpandedChange = { deptDropdownExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedDept.displayName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Starting Department") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = deptDropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    )
                    ExposedDropdownMenu(
                        expanded = deptDropdownExpanded,
                        onDismissRequest = { deptDropdownExpanded = false }
                    ) {
                        Department.entries.forEach { dept ->
                            DropdownMenuItem(
                                text = { Text(dept.displayName) },
                                onClick = {
                                    selectedDept = dept
                                    deptDropdownExpanded = false
                                }
                            )
                        }
                    }
                }

                // Heat treatment checkbox
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = heatTreatmentRequired,
                        onCheckedChange = { heatTreatmentRequired = it }
                    )
                    Text("Heat Treatment Required")
                }

                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Drawing / Technical Notes") },
                    maxLines = 2,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val q = orderQtyText.toDoubleOrNull() ?: 100.0
                    val newCard = JobCard(
                        jobCardNo = jobCardNo.trim(),
                        orderNo = orderNo.trim(),
                        partyName = partyName.ifEmpty { "General Party" },
                        itemName = itemName.ifEmpty { "Machined Pin" },
                        itemCode = itemCode.trim(),
                        orderQty = q,
                        currentQty = q,
                        unit = unit,
                        balanceQty = 0.0,
                        currentDepartment = selectedDept,
                        status = JobCardStatus.PENDING,
                        priority = priority,
                        heatTreatmentRequired = heatTreatmentRequired,
                        notes = notes.trim(),
                        createdAt = System.currentTimeMillis()
                    )
                    onConfirm(newCard)
                },
                enabled = itemName.isNotEmpty()
            ) {
                Text("Create Job Card")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
