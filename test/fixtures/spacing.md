Title: Spacing Fixture  
Author:

# Chapter without text #


BLOCK

## After the empty chapter ##

after text

# Chapter with text #


BLOCK

chapter text

## After the chapter ##

more text

# Returning after a footnote #

returning text

## Ends with a note ##

ends with a note[^cf1]RETURN


# Returning after a note and a line break #

returning text

## Ends with a note, then a paragraph break ##

ends with a note[^cf2]
RETURN


# Returning after a list #

returning text

## Ends with a list ##

before

* one
* two

RETURN


# Children filtered out #

# After the filtered #

last text

[^cf1]: the note

[^cf2]: another note