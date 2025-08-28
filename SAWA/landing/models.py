from django.db import models

# we will use other approach but let it here if we needed it.
class LandingContent(models.Model):
    title = models.CharField(max_length=255)
    content = models.TextField()
    image = models.ImageField(upload_to='landing_images/')