from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.create_meeting, name='create_meeting'),
    # re regex
    path('join/', views.join_meeting_outer, name='join_meeting_outer'),
    path('join/<str:meeting_id>/', views.join_meeting, name='join_meeting'),
    path('instant/', views.join_instant_meeting, name='join_instant_meeting'),
    path('leave/<str:meeting_id>/', views.leave_meeting, name = "leave_meeting"),
    path('detail/<int:meeting_id>/', views.meeting_detail, name='meeting_detail'),
    path('update/<int:meeting_id>/', views.update_meeting, name='update_meeting'),
    path('delete/<int:meeting_id>/', views.delete_meeting, name='delete_meeting'),
    path('not-found/', views.meeting_not_found, name='meeting_not_found'),
    path('waiting-room/<str:meeting_id>/',views.waiting_room, name='waiting_room'),

    # Agora Video Meeting URLs
    path('get_token/', views.get_token, name='get_token'),
    path('create_member/', views.create_member, name='create_member'),
    path('get_member/', views.get_member, name='get_member'),
    path('delete_member/', views.delete_member, name='delete_member'),
    path('host_leave_meeting/', views.host_leave_meeting,
         name='host_leave_meeting'),
    path('check_status/<str:meeting_id>/',views.check_meeting_status, name='check_meeting_status'),

    # Dubbing & Translation URLs
    path('translate/audio/', views.translate_audio, name='translate_audio'),
    path('generate_caption/', views.generate_caption, name='generate_caption')
]
