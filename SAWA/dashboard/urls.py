from django.urls import path
from . import views

urlpatterns = [
    # Normal User Dashboard
    path('', views.dashboard_home, name='dashboard_home'),
    path('meetings/', views.meetings_history, name='dashboard_meetings_history'),
    path('recordings/', views.recordings, name='dashboard_recordings'),
    path('contacts/', views.contacts, name='dashboard_contacts'),
    path('search/', views.search, name = "search"),
    # Admin Dashboard
    path('admin-dashboard/', views.admin_dashboard, name = 'admin_dashboard'),
    path('user-management', views.user_management, name = 'user_management'),
    path('meeting-oversights', views.meeting_oversights, name = 'meeting_oversights'),
    path('translation-usage', views.translation_usage, name = 'translation_usage'),
    path('platform-settings', views.platform_settings, name = 'platform_settings'),
    path('support-feedback', views.support_feedback, name = 'support_feedback'),
    path('system-logs', views.system_logs, name = 'system_logs'),
    path('users/edit/<int:user_id>/', views.edit_user, name='edit_user'),
    path('users/delete/<int:user_id>/', views.delete_user, name='delete_user'),
    path('meetings/edit/<int:meeting_id>/', views.edit_meeting, name='edit_meeting'),
    path('meetings/remove-participant/<int:meeting_id>/<int:user_id>/', views.remove_participant, name='remove_participant'),
    path('meetings/delete/<int:meeting_id>/', views.delete_meeting, name='delete_meeting'),
    path('close-feedback/<int:feedback_id>/', views.close_feedback, name='close_feedback'),
]
