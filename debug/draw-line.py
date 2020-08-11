import matplotlib.pyplot as plt

fig = plt.figure()
ax = plt.axes()

x = 'x'
y = 'y'

data = []

plt.plot([pt['x'] for pt in data], [pt['y'] for pt in data])

plt.savefig('unit-path.png')
print("done")
