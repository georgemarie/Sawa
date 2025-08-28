from django.shortcuts import render, redirect
from .models import SupportTicket
from django.core.mail import send_mail
from django.conf import settings

def help_view(request):
    message = None
    if request.method == 'POST':
        name = request.POST.get('name')
        email = request.POST.get('email')
        description = request.POST.get('description')
        if name and email and description:
            if request.user.is_authenticated:
                SupportTicket.objects.create (
                    user=request.user,
                    subject=email,
                    description=description
                )
            # Send email to company
            send_mail(
                subject=f"New Support Request from {name}",
                message=f"Name: {name}\nEmail: {email}\n\nMessage:\n{description}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=['sawa2025.cu@gmail.com'],
                fail_silently=False,
            )
            message = "Your request has been submitted successfully!"
        else:
            message = "Please fill in all fields."
    return render(request, 'Help&Support/hep&support.html', {'message': message})