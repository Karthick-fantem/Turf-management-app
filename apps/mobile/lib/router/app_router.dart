import 'package:go_router/go_router.dart';
import '../features/auth/auth_screen.dart';
import '../features/home/home_screen.dart';
import '../features/navigation/main_navigation_screen.dart';
import '../features/profile/profile_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/auth',
  routes: [
    GoRoute(
      path: '/auth',
      builder: (context, state) => const AuthScreen(),
    ),
    GoRoute(
      path: '/',
      builder: (context, state) => const MainNavigationScreen(),
    ),
    GoRoute(
      path: '/profile',
      builder: (context, state) => const ProfileScreen(),
    ),
  ],
);
