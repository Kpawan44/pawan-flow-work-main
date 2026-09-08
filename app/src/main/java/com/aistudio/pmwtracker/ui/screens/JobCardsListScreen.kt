package com.aistudio.pmwtracker.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.ui.components.JobCardItem
import com.aistudio.pmwtracker.ui.viewmodel.PmwViewModel

@Composable
fun JobCardsListScreen(
    viewModel: PmwViewModel,
    onSelectJobCard: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val jobCards by viewModel.filteredJobCards.collectAsState()
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp)
    ) {
        Spacer(modifier = Modifier.height(8.dp))

        // Search bar
        OutlinedTextField(
            value = uiState.searchQuery,
            onValueChange = { viewModel.setSearchQuery(it) },
            label = { Text("Search by JC No, Item, or Customer...") },
            leadingIcon = {
                Icon(imageVector = Icons.Default.Search, contentDescription = "Search")
            },
            trailingIcon = {
                if (uiState.searchQuery.isNotEmpty()) {
                    IconButton(onClick = { viewModel.setSearchQuery("") }) {
                        Icon(imageVector = Icons.Default.Clear, contentDescription = "Clear")
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(10.dp))

        // Department filter chips
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 4.dp)
        ) {
            item {
                FilterChip(
                    selected = uiState.selectedDepartmentFilter == null,
                    onClick = { viewModel.setDepartmentFilter(null) },
                    label = { Text("All (${jobCards.size})") }
                )
            }
            items(Department.entries) { dept ->
                FilterChip(
                    selected = uiState.selectedDepartmentFilter == dept,
                    onClick = {
                        if (uiState.selectedDepartmentFilter == dept) {
                            viewModel.setDepartmentFilter(null)
                        } else {
                            viewModel.setDepartmentFilter(dept)
                        }
                    },
                    label = { Text(dept.displayName) }
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Job Cards list
        if (jobCards.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "No Job Cards Found",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Try adjusting your search or department filter",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(bottom = 24.dp)
            ) {
                items(jobCards, key = { it.jobCardNo }) { card ->
                    JobCardItem(
                        jobCard = card,
                        onCardClick = { onSelectJobCard(card.jobCardNo) },
                        onTransferClick = { viewModel.openTransferDialog(card) }
                    )
                }
            }
        }
    }
}
