from datetime import datetime
from django.shortcuts import redirect, render
from .models import *
from meetings.models import *
from accounts.models import *
from django.utils import timezone
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db import models
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect
from django.contrib.auth import get_user_model
from django.views.decorators.csrf import csrf_exempt
import re
from collections import defaultdict
from django.db.models.functions import ExtractMonth
import calendar
from django.db.models.functions import TruncMonth
from support.models import *

# render to Dashboard if user is authenticated else render to landing page.
def dashboard_home(request):
    user = request.user
    if not user.is_authenticated:
        return redirect("landing_home")
    
    if user.guest : 
        return redirect ("logout")
    
    user_role = UserRole.objects.get(user=user)
    if user_role.role.name == 'admin':
        return redirect('admin_dashboard')
    # Get all meetings where user is either creator or participant and the schedule date is greater than or equal today
    meetings = Meeting.objects.filter(
        (models.Q(creator=user) |
        models.Q(meetingparticipant__user=user)), scheduled_date__gte=timezone.now().date()
    ).distinct().order_by('-scheduled_date', '-meeting_time')

    return render(request, 'dashboard/dashboard.html', {
        'upcoming_meetings': meetings,
        'user': user,
        'upcoming': True
    })

#######################################################################################

# Gets Past Meetings
@login_required
def meetings_history(request):
    user = request.user
    if user.guest : 
        return redirect ("logout")
    # Get all meetings where user is either creator or participant and the schedule date is older than today
    past_meetings = Meeting.objects.filter(
        (models.Q(creator=user) |
        models.Q(meetingparticipant__user=user)),
        scheduled_date__lt=timezone.now().date()
    ).distinct().order_by('-scheduled_date', '-meeting_time')

    return render(request, 'dashboard/dashboard.html', {
        'past_meetings': past_meetings,
        'history': True,
        'user': request.user
    })


#######################################################################################

# will not be implemented in demo.
@login_required
def recordings(request):
    if request.user.guest : 
        return redirect ("logout")
    return render(request, 'dashboard/dashboard.html', {
        'recordings': True,
        'user': request.user
    })


#######################################################################################

# will not be implemented in demo
@login_required
def contacts(request):
    if request.user.guest : 
        return redirect ("logout")
    return render(request, 'dashboard/dashboard.html', {
        'contacts': True,
        'user': request.user
    })

#######################################################################################

# Take a query and type of meetings to search in.
@login_required
def search(request):
    user = request.user
    if user.guest:
        return redirect("logout")

    query = request.GET.get('q', '').strip()
    search_type = request.GET.get('type', 'upcoming')

    # print(query)
    # print(search_type) 
    base_filter = (
        models.Q(creator=user) |
        models.Q(meetingparticipant__user=user)
    )

    if search_type == 'history':
        date_filter = models.Q(scheduled_date__lt=timezone.now().date())
        context_flag = 'history'
        meetings_label = 'past_meetings'
    else:
        date_filter = models.Q(scheduled_date__gte=timezone.now())
        context_flag = 'upcoming'
        meetings_label = 'upcoming_meetings'

    if query:
        meetings = Meeting.objects.filter(
            base_filter & date_filter,
            title__icontains=query
        ).distinct().order_by('-scheduled_date', '-meeting_time')
    else:
        meetings = Meeting.objects.filter(
            base_filter & date_filter
        ).distinct().order_by('-scheduled_date', '-meeting_time')

    context = {
        'user': user,
        'search_query': query,
        'search_type': search_type,
        context_flag: True,
        meetings_label: meetings,
    }
    return render(request, 'dashboard/dashboard.html', context)

#######################################################################################
# Admin Dashboard
#######################################################################################

@login_required
def admin_dashboard(request):
    user = request.user

    if user.guest:
        return redirect("logout")

    user_role = UserRole.objects.get(user=user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')

    users = User.objects.all().count()
    auth_users = User.objects.filter(guest=False).count()
    meetings = Meeting.objects.all().count()
    translations = 0  # will add a model for it

    # Get last 3 months
    today = timezone.now()
    last_three_months = [(today - timezone.timedelta(days=30 * i)).date().replace(day=1) for i in reversed(range(3))]

    # Users per month
    user_counts = defaultdict(int)
    user_qs = User.objects.filter(date_joined__date__gte=last_three_months[0])
    for user_obj in user_qs:
        month = user_obj.date_joined.month
        user_counts[month] += 1

    # Meetings per month
    meeting_counts = defaultdict(int)
    meeting_qs = Meeting.objects.filter(scheduled_date__gte=last_three_months[0])
    for meeting in meeting_qs:
        month = meeting.scheduled_date.month
        meeting_counts[month] += 1
        

    # labels and values for chart
    month_labels = [calendar.month_abbr[month.month].upper() for month in last_three_months]
    user_growth = [user_counts[month.month] for month in last_three_months]
    meeting_growth = [meeting_counts[month.month] * 10 for month in last_three_months]
    normalized_user_growth = normalize(user_growth)
    month_data = zip(month_labels, normalized_user_growth)
    meeting_growth_percent = calculate_growth_percentage(meeting_growth)
    user_growth_percent = calculate_growth_percentage(user_growth)
    normalized_user_growth = normalize_user(user_growth, height=120)

    svg_width = 400
    svg_height = 150
    spacing = svg_width // (len(user_growth) - 1)

    line_points = [(i * spacing, y) for i, y in enumerate(normalized_user_growth)]
    svg_path = bezier_path(line_points)

    context = {
        'users': users,
        'auth_users': auth_users,
        'meetings': meetings,
        'translations': translations,
        'month_labels': month_labels,
        'user_growth': user_growth,
        'meeting_growth': meeting_growth,
        'month_data' : month_data,
        'meeting_growth_percent': meeting_growth_percent,
        'is_positive_growth': meeting_growth_percent >= 0,
        'user_growth_percent': user_growth_percent,
        'is_user_growth_positive': user_growth_percent >= 0,
        'svg_path': svg_path,
        'line_points': line_points,
        'svg_width': svg_width,
        'svg_height': svg_height,
    }
    return render(request, 'Admin Dashboard/main page.html', context)

#######################################################################################

def normalize(data, max_height=100):
    max_val = max(data) or 1  # prevent division by zero
    return [int((val / max_val) * max_height) for val in data]

def normalize_user(data, height=120):
    max_val = max(data) or 1
    return [height - int((value / max_val) * height) for value in data]  # Flip Y for SVG

def bezier_path(points):
    if not points or len(points) < 2:
        return ""

    d = f"M {points[0][0]},{points[0][1]} "
    for i in range(1, len(points)):
        x0, y0 = points[i - 1]
        x1, y1 = points[i]
        # Calculate mid-point for smooth curve
        mid_x = (x0 + x1) / 2
        d += f"Q {x0},{y0} {mid_x},{(y0 + y1) / 2} "
    # Add last point
    d += f"T {points[-1][0]},{points[-1][1]}"
    return d

def calculate_growth_percentage(data):
    if len(data) < 2 or data[-2] == 0:
        return 0
    growth = ((data[-1] - data[-2]) / data[-2]) * 100
    print(data[-1], data[-2])
    return round(growth, 1)

#######################################################################################

@login_required
def user_management(request):
    user = request.user # gets user

    # if user is guest logout
    if user.guest : 
        return redirect ("logout")
    
    # if user not admin redirect to dashboard
    user_role = UserRole.objects.get(user = user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')
    
    query = request.GET.get('q', '').strip()

    users = User.objects.filter(guest=False, userrole__role__name__iexact='admin').distinct()
    users = User.objects.filter(guest=False).exclude(id__in=users.values_list('id', flat=True))

    if query:
        users = users.filter(
            models.Q(first_name__icontains=query) |
            models.Q(last_name__icontains=query) |
            models.Q(email__icontains=query) |
            models.Q(phone_number__icontains=query)
        )

    context = {
        'users' : users,
        'query' : query
    }

    return render(request, 'Admin Dashboard/User Management.html', context)

#######################################################################################

@login_required
def meeting_oversights(request):
    user = request.user

    if user.guest:
        return redirect("logout")

    user_role = UserRole.objects.get(user=user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')

    query = request.GET.get('q', '').strip()

    meetings = Meeting.objects.all()

    # Apply search filter if any
    if query:
        meetings = meetings.filter(
            Q(title__icontains=query) |
            Q(description__icontains=query) |
            Q(creator__first_name__icontains=query) |
            Q(creator__last_name__icontains=query)
        )

    meetings_details = []
    for meeting in meetings:
        participants = MeetingParticipant.objects.filter(meeting=meeting).distinct()
        meetings_details.append({
            'meeting': meeting,
            'participants': participants,
            'participants_num': len(participants)
        })

    # Chart logic
    all_meetings = Meeting.objects.all()
    monthly_counts = defaultdict(int)
    for meeting in all_meetings:
        month_num = meeting.scheduled_date.month
        monthly_counts[month_num] += 1

    today = datetime.today()
    current_month = today.month
    chart_data = [monthly_counts[i] * 5 if i <= current_month else 0 for i in range(1, 13)]
    month_labels = [calendar.month_abbr[i].upper() for i in range(1, 13)]
    chart = zip(month_labels, chart_data)

    context = {
        'meetings': meetings_details,
        'chart_data': chart_data,
        'chart': chart,
        'query': query,
    }

    return render(request, 'Admin Dashboard/Meeting Oversights.html', context)

#######################################################################################

@login_required
def translation_usage(request):
    user = request.user # gets user

    # if user is guest logout
    if user.guest : 
        return redirect ("logout")
    
    # if user not admin redirect to dashboard
    user_role = UserRole.objects.get(user = user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')
    return render(request, 'Admin Dashboard/Translation and Usage.html')

#######################################################################################

@login_required
def platform_settings(request):
    user = request.user # gets user

    # if user is guest logout
    if user.guest : 
        return redirect ("logout")
    
    # if user not admin redirect to dashboard
    user_role = UserRole.objects.get(user = user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')
    return render(request, 'Admin Dashboard/Platform Settings.html')

#######################################################################################

@login_required
def support_feedback(request):
    user = request.user # gets user

    # if user is guest logout
    if user.guest : 
        return redirect ("logout")
    
    # if user not admin redirect to dashboard
    user_role = UserRole.objects.get(user = user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')
    
    open_feedbacks = SupportTicket.objects.filter(status='open')
    closed_feedbacks = SupportTicket.objects.filter(status='closed')

    context = {
        'open_feedbacks' : open_feedbacks ,
        'closed_feedbacks' : closed_feedbacks 
    }
    return render(request, 'Admin Dashboard/Support & Feedback.html', context)


@login_required
def close_feedback(request, feedback_id):
    user = request.user

    # Optional: check for permissions
    user_role = UserRole.objects.get(user=user)
    if user.guest or user_role.role.name != 'admin':
        return redirect('dashboard_home')

    if request.method == 'POST':
        feedback = get_object_or_404(SupportTicket, id=feedback_id)
        feedback.status = 'closed'
        feedback.save()
    
    return redirect('support_feedback')
#######################################################################################

@login_required
def system_logs(request):
    user = request.user # gets user

    # if user is guest logout
    if user.guest : 
        return redirect ("logout")
    
    # if user not admin redirect to dashboard
    user_role = UserRole.objects.get(user = user)
    if user_role.role.name != 'admin':
        return redirect('dashboard_home')
    
    logs = SystemLogs.objects.all()
    query = request.GET.get('q', '').strip()

    # Apply search filter if any
    if query:
        logs = logs.filter(
            Q(action__icontains=query) |
            Q(user__first_name__icontains=query) |
            Q(user__last_name__icontains=query) |
            Q(user__email__icontains=query)
        )

    context={
        'logs' : logs,
        'query': query,
    }
    return render(request, 'Admin Dashboard/System Logs & Audit Trail.html', context)

############################################################################################

User = get_user_model()

@csrf_exempt
def edit_user(request, user_id):
    user = get_object_or_404(User, id=user_id)

    if request.method == 'POST':
        first_name = request.POST.get('first_name')
        last_name = request.POST.get('last_name')
        email = request.POST.get('email')
        phone_number = request.POST.get('phone_number')
        preferred_language = request.POST.get('preferred_language')
        gender = request.POST.get('gender')

        # Egyptian phone number pattern
        egyptian_phone_pattern = r"^01[0125][0-9]{8}$"

        # Validate email (exclude current user's email)
        if User.objects.filter(email=email).exclude(id=user.id).exists():
            messages.error(request, "Email is already registered!")
            return redirect('user_management')

        # Validate phone number format
        if not re.match(egyptian_phone_pattern, phone_number):
            messages.error(request, "Please enter a valid Egyptian number!")
            return redirect('user_management')

        # Validate phone number uniqueness (exclude current user's number)
        if User.objects.filter(phone_number=phone_number).exclude(id=user.id).exists():
            messages.error(request, "This number is already registered!")
            return redirect('user_management')

        # Save changes
        user.first_name = first_name
        user.last_name = last_name
        user.email = email
        user.phone_number = phone_number
        user.preferred_language = preferred_language
        user.gender = gender
        user.save()

        messages.success(request, "User updated successfully.")
    
    return redirect('user_management')

def delete_user(request, user_id):
    user = get_object_or_404(User, id=user_id)
    user.delete()
    messages.success(request, "User deleted successfully.")
    return redirect('user_management')

############################################################################################

@login_required
def edit_meeting(request, meeting_id):
    meeting = get_object_or_404(Meeting, id=meeting_id)

    if request.method == 'POST':
        title = request.POST.get('title')
        description = request.POST.get('description')
        scheduled_date = request.POST.get('scheduled_date')
        meeting_time = request.POST.get('meeting_time')

        # Validate required fields
        if not title or not scheduled_date or not meeting_time:
            messages.error(request, "All fields are required.")
            return redirect('meeting_oversights')

        try:
            meeting.title = title
            meeting.description = description
            meeting.scheduled_date = scheduled_date
            meeting.meeting_time = meeting_time
            meeting.save()
            messages.success(request, "Meeting updated successfully.")
        except Exception as e:
            messages.error(request, f"Error updating meeting: {str(e)}")

    return redirect('meeting_oversights')


@login_required
def remove_participant(request, meeting_id, user_id):
    meeting = get_object_or_404(Meeting, id=meeting_id)

    try:
        participant = MeetingParticipant.objects.get(meeting=meeting, user__id=user_id)
        participant.delete()
        messages.success(request, "Participant removed successfully.")
    except MeetingParticipant.DoesNotExist:
        messages.error(request, "Participant not found.")

    return redirect('meeting_oversights')


@login_required
def delete_meeting(request, meeting_id):
    if request.method == 'POST':
        meeting = get_object_or_404(Meeting, id=meeting_id)
        meeting.delete()
        messages.success(request, "Meeting deleted successfully.")
    else:
        messages.error(request, "Invalid request method.")
    
    return redirect('meeting_oversights')

############################################################################################

