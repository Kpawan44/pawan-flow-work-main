package com.aistudio.pmwtracker.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickTransferDialog(
    jobCard: JobCard,
    onDismiss: () -> Unit,
    onConfirm: (toDept: Department, quantity: Double, operator: String, remarks: String) -> Unit
) {
    var selectedDept by remember {
        val nextDept = when (jobCard.currentDepartment) {
            Department.PURCHASE -> Department.RAW_MATERIAL_STORE
            Department.RAW_MATERIAL_STORE -> Department.PRODUCTION
            Department.PRODUCTION -> if (jobCard.heatTreatmentRequired) Department.HEAT_TREATMENT else Department.PLATING
            Department.HEAT_TREATMENT -> Department.PLATING
            Department.PLATING -> Department.PACKING
            Department.PACKING -> Department.STORE
            Department.STORE -> Department.DISPATCH
            Department.DISPATCH -> Department.STORE
        }
        mutableStateOf(nextDept)
    }

    var qtyText by remember { mutableStateOf(jobCard.currentQty.toString()) }
    var operatorText by remember { mutableStateOf(jobCard.operatorName.ifEmpty { "Pawan Kumar" }) }
    var remarksText by remember { mutableStateOf("") }
    var dropdownExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(
                    text = "Transfer Material",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${jobCard.jobCardNo} • ${jobCard.itemName}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // From Dept
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "From: ",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    DepartmentBadge(department = jobCard.currentDepartment)
                }

                // Destination Dept Dropdown
                ExposedDropdownMenuBox(
                    expanded = dropdownExpanded,
                    onExpandedChange = { dropdownExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedDept.displayName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("To Department") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    )
                    ExposedDropdownMenu(
                        expanded = dropdownExpanded,
                        onDismissRequest = { dropdownExpanded = false }
                    ) {
                        Department.entries.filter { it != jobCard.currentDepartment }.forEach { dept ->
                            DropdownMenuItem(
                                text = { Text(dept.displayName) },
                                onClick = {
                                    selectedDept = dept
                                    dropdownExpanded = false
                                }
                            )
                        }
                    }
                }

                // Transfer Qty
                OutlinedTextField(
                    value = qtyText,
                    onValueChange = { qtyText = it },
                    label = { Text("Transfer Quantity (${jobCard.unit})") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Operator Name
                OutlinedTextField(
                    value = operatorText,
                    onValueChange = { operatorText = it },
                    label = { Text("Operator / Incharge Name") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Remarks
                OutlinedTextField(
                    value = remarksText,
                    onValueChange = { remarksText = it },
                    label = { Text("Transfer Remarks / Batch Notes") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 2
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val q = qtyText.toDoubleOrNull() ?: jobCard.currentQty
                    onConfirm(selectedDept, q, operatorText, remarksText)
                }
            ) {
                Text("Confirm Transfer")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
