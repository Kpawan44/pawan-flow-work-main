import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:mfr_mfg_flutter_app/main.dart';

void main() {
  testWidgets('manufacturing app boots', (WidgetTester tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AppStateProvider(),
        child: const MfgApp(),
      ),
    );
    await tester.pump();
    expect(find.byType(MfgApp), findsOneWidget);
  });
}
