import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import 'models/job_card.dart';
import 'models/material_movement.dart';
import 'models/user_profile.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppStateProvider()),
      ],
      child: const MfgApp(),
    ),
  );
}

class AppStateProvider extends ChangeNotifier {
  bool _isLoggedIn = true;
  bool _isOnline = true;
  int _activeNavIndex = 0;
  
  UserProfile _currentUser = UserProfile(
    userId: 'u-1',
    name: 'Pawan Kumar',
    email: 'pawan.kumar28111993@gmail.com',
    role: 'super_admin',
    department: 'Admin',
    isActive: true,
  );

  List<JobCard> _jobCards = [
    JobCard(
      jobCardNo: 'JC-1001',
      partyName: 'Tata Motors Assembly Unit',
      itemName: 'HEX BOLT M12 x 50 GRADE 8.8',
      itemCode: 'BOLT-M12-G8',
      orderQty: 2500,
      netWeight: 450,
      unit: 'KGS',
      currentDepartment: 'Heat Treatment',
      status: 'In Production',
      createdAt: DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
    ),
    JobCard(
      jobCardNo: 'JC-1002',
      partyName: 'Mahindra & Mahindra Automotive',
      itemName: 'STUD M10 x 40 HIGH TENSILE',
      itemCode: 'STUD-M10-HT',
      orderQty: 1800,
      netWeight: 320,
      unit: 'KGS',
      currentDepartment: 'Production',
      status: 'In Production',
      createdAt: DateTime.now().subtract(const Duration(days: 1)).toIso8601String(),
    ),
  ];

  List<MaterialMovement> _movements = [
    MaterialMovement(
      movementId: 'm-1',
      jobCardNo: 'JC-1001',
      fromDepartment: 'Production',
      toDepartment: 'Heat Treatment',
      quantity: 450,
      requestedUnit: 'KGS',
      transferBy: 'Pawan Kumar',
      transferDate: DateTime.now().subtract(const Duration(hours: 4)).toIso8601String(),
      accepted: true,
      acceptedBy: 'Suresh Heat Treatment Lead',
      acceptedDate: DateTime.now().subtract(const Duration(hours: 3)).toIso8601String(),
    )
  ];

  bool get isLoggedIn => _isLoggedIn;
  bool get isOnline => _isOnline;
  int get activeNavIndex => _activeNavIndex;
  UserProfile get currentUser => _currentUser;
  List<JobCard> get jobCards => _jobCards;
  List<MaterialMovement> get movements => _movements;

  void setActiveNavIndex(int index) {
    _activeNavIndex = index;
    notifyListeners();
  }

  void toggleOnlineStatus() {
    _isOnline = !_isOnline;
    notifyListeners();
  }

  void addMovement(MaterialMovement movement) {
    _movements.insert(0, movement);
    notifyListeners();
  }

  void logout() {
    _isLoggedIn = false;
    notifyListeners();
  }

  void login(String email, String role, String dept) {
    _currentUser = UserProfile(
      userId: 'u-${DateTime.now().millisecondsSinceEpoch}',
      name: email.split('@').first.toUpperCase(),
      email: email,
      role: role,
      department: dept,
      isActive: true,
    );
    _isLoggedIn = true;
    notifyListeners();
  }
}

class MfgApp extends StatelessWidget {
  const MfgApp({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);

    return MaterialApp(
      title: 'MFR Manufacturing ERP',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3B82F6),
          brightness: Brightness.light,
          primary: const Color(0xFF2563EB),
          surface: const Color(0xFFF8FAFC),
        ),
        textTheme: GoogleFonts.interTextTheme(),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3B82F6),
          brightness: Brightness.dark,
          primary: const Color(0xFF60A5FA),
          surface: const Color(0xFF0F172A),
        ),
        textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
      ),
      themeMode: ThemeMode.system,
      home: state.isLoggedIn ? const MainAndroidShell() : const LoginScreen(),
    );
  }
}

class MainAndroidShell extends StatelessWidget {
  const MainAndroidShell({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);
    final isTablet = MediaQuery.of(context).size.width >= 600;

    final pages = [
      const DashboardScreen(),
      const JobCardsOrderScreen(),
      const QRScannerScreen(),
      const ProductionTrackingScreen(),
      const ProfileSettingsScreen(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'PRO-MFG ERP',
              style: GoogleFonts.sansita(
                fontSize: 16,
                fontWeight: FontWeight.w900,
                letterSpacing: 0.5,
              ),
            ),
            Text(
              '${state.currentUser.department} • Node #1',
              style: const TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: Icon(
              state.isOnline ? Icons.wifi : Icons.wifi_off,
              color: state.isOnline ? const Color(0xFF10B981) : Colors.amber,
            ),
            tooltip: state.isOnline ? 'Online Sync Active' : 'Offline Queue Mode',
            onPressed: () => state.toggleOnlineStatus(),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('All manufacturing alerts synced.')),
              );
            },
          ),
        ],
      ),
      body: isTablet
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: state.activeNavIndex,
                  onDestinationSelected: (i) => state.setActiveNavIndex(i),
                  labelType: NavigationRailLabelType.all,
                  destinations: const [
                    NavigationRailDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: Text('Dashboard')),
                    NavigationRailDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: Text('Orders')),
                    NavigationRailDestination(icon: Icon(Icons.qr_code_scanner), selectedIcon: Icon(Icons.qr_code_scanner_sharp), label: Text('Scan')),
                    NavigationRailDestination(icon: Icon(Icons.timeline), selectedIcon: Icon(Icons.timeline_sharp), label: Text('Tracking')),
                    NavigationRailDestination(icon: Icon(Icons.person_outlined), selectedIcon: Icon(Icons.person), label: Text('Profile')),
                  ],
                ),
                const VerticalDivider(thickness: 1, width: 1),
                Expanded(child: pages[state.activeNavIndex]),
              ],
            )
          : pages[state.activeNavIndex],
      bottomNavigationBar: isTablet
          ? null
          : NavigationBar(
              selectedIndex: state.activeNavIndex,
              onDestinationSelected: (i) => state.setActiveNavIndex(i),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
                NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: 'Orders'),
                NavigationDestination(icon: Icon(Icons.qr_code_scanner), selectedIcon: Icon(Icons.qr_code_scanner_sharp), label: 'QR Scan'),
                NavigationDestination(icon: Icon(Icons.timeline), selectedIcon: Icon(Icons.timeline_sharp), label: 'Tracking'),
                NavigationDestination(icon: Icon(Icons.person_outlined), selectedIcon: Icon(Icons.person), label: 'Profile'),
              ],
            ),
    );
  }
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: Theme.of(context).colorScheme.primaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  child: Text(state.currentUser.name[0], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Welcome, ${state.currentUser.name}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text('Role: ${state.currentUser.role.toUpperCase()} • Dept: ${state.currentUser.department}', style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _MetricCard(
                title: 'Total Job Cards',
                value: '${state.jobCards.length}',
                icon: Icons.list_alt,
                color: Colors.blue,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _MetricCard(
                title: 'Live Movements',
                value: '${state.movements.length}',
                icon: Icons.local_shipping,
                color: const Color(0xFF10B981),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        const Text('Active Department Queue', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 8),
        ...state.jobCards.map((jc) => Card(
          child: ListTile(
            leading: const Icon(Icons.build, color: Colors.blue),
            title: Text(jc.jobCardNo, style: const TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Text('${jc.itemName}\nDept: ${jc.currentDepartment}'),
            trailing: Chip(label: Text('${jc.orderQty} ${jc.unit}'), backgroundColor: Colors.blue.shade50),
          ),
        )),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _MetricCard({required this.title, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 1,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 8),
            Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
            Text(title, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

class JobCardsOrderScreen extends StatelessWidget {
  const JobCardsOrderScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);

    return Padding(
      padding: const EdgeInsets.all(12),
      child: ListView.builder(
        itemCount: state.jobCards.length,
        itemBuilder: (context, i) {
          final jc = state.jobCards[i];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(jc.jobCardNo, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.blue)),
                      Chip(
                        label: Text(jc.status, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                        backgroundColor: Colors.amber.shade100,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(jc.itemName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  Text('Party: ${jc.partyName}', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                  const Divider(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Quantity: ${jc.orderQty} ${jc.unit}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      Text('Current: ${jc.currentDepartment}', style: TextStyle(fontSize: 11, color: Colors.blue.shade700, fontWeight: FontWeight.w600)),
                    ],
                  )
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class QRScannerScreen extends StatelessWidget {
  const QRScannerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.qr_code_scanner, size: 80, color: Colors.blue),
            const SizedBox(height: 16),
            const Text('Camera QR Barcode Scanner', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 8),
            const Text('Scan Job Card QR label to auto-open movement details', style: TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              icon: const Icon(Icons.camera_alt),
              label: const Text('Simulate Scan JC-1001'),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Scanned JC-1001 successfully! Opening details.')),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class ProductionTrackingScreen extends StatelessWidget {
  const ProductionTrackingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('Real-Time Production & Transit Timeline', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 12),
        ...state.movements.map((mov) => Card(
          child: ListTile(
            leading: const CircleAvatar(child: Icon(Icons.local_shipping, size: 20)),
            title: Text('${mov.jobCardNo} • ${mov.quantity} ${mov.requestedUnit}'),
            subtitle: Text('${mov.fromDepartment} ➔ ${mov.toDepartment}\nBy: ${mov.transferBy}'),
            trailing: Icon(
              mov.accepted ? Icons.check_circle : Icons.pending,
              color: mov.accepted ? const Color(0xFF10B981) : Colors.amber,
            ),
          ),
        )),
      ],
    );
  }
}

class ProfileSettingsScreen extends StatelessWidget {
  const ProfileSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ListTile(
          leading: const Icon(Icons.person),
          title: Text(state.currentUser.name),
          subtitle: Text('${state.currentUser.email} • ${state.currentUser.role}'),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.sync),
          title: const Text('Offline Sync Status'),
          subtitle: Text(state.isOnline ? 'Online (Firebase Firestore)' : 'Offline (Local Storage Queue)'),
          trailing: Switch(
            value: state.isOnline,
            onChanged: (_) => state.toggleOnlineStatus(),
          ),
        ),
        ListTile(
          leading: const Icon(Icons.phone_android),
          title: const Text('Android Mobile Build'),
          subtitle: const Text('Flutter 3.x Material 3 APK Edition'),
        ),
        const SizedBox(height: 20),
        ElevatedButton.icon(
          style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
          icon: const Icon(Icons.logout),
          label: const Text('Sign Out'),
          onPressed: () => state.logout(),
        ),
      ],
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController(text: 'pawan.kumar28111993@gmail.com');

  @override
  Widget build(BuildContext context) {
    final state = Provider.of<AppStateProvider>(context, listen: false);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.factory, size: 64, color: Colors.blue),
              const SizedBox(height: 12),
              Text('PRO-MFG ERP Mobile', style: GoogleFonts.inter(fontSize: 22, fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              const Text('Secure Crew Login Terminal', style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 32),
              TextField(
                controller: _emailCtrl,
                decoration: const InputDecoration(labelText: 'Email Address', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.all(16), backgroundColor: Colors.blue, foregroundColor: Colors.white),
                  onPressed: () => state.login(_emailCtrl.text, 'super_admin', 'Admin'),
                  child: const Text('Sign In to Mobile Terminal', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
