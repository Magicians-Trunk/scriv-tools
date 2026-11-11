Title: Raw Markup Fixture  
Author:

# Raw paragraph, custom field #

before 
[raw]raw  end[/raw]
after 

# Raw paragraph, title #

before Raw paragraph, title
[raw]raw Raw paragraph, title end[/raw]
after Raw paragraph, title

# Raw paragraph, counter #

before 1
[raw]raw 2 end[/raw]
after 3

# Raw paragraph, punctuation #

before "it's"
[raw]raw "it's" end[/raw]
after "it's"

# Raw paragraph, replacement #

before SWAPPED
[raw]raw SWAPPED end[/raw]
after SWAPPED

# Raw span, custom field #

before {raw  end} after 

# Raw span, title #

before {raw Raw span, title end} after Raw span, title

# Raw span, counter #

before {raw 4 end} after 5

# Raw span, punctuation #

before {raw "it's" end} after "it's"

# Raw span, replacement #

before {raw SWAPPED end} after SWAPPED